// Hands-free "Hi Jhyvie". Listens on this device, works out when you've stopped talking, and wakes only on
// "hi/hey + the pal's name". Nothing leaves the device unless that wake phrase was heard.
//
//   mic → wake-word engine (wakeword.ts): "Hi {pal}" caught ~0.2s after the name, while they're still talking
//       → Silero voice detector (one clip per utterance: ends after 0.5s of silence while waiting for the wake
//   phrase, 2s once awake so a pause mid-request doesn't cut it)
//       → Whisper base on this device → matchWake(): not for Pal? dropped, never sent anywhere (Whisper is also the
//         wake detector when the engine misses one, can't load, or Pal is talking)
//       → the command: Groq's Whisper re-hears just that clip when allowed (better Taglish), else the device's text
// While Pal talks it keeps listening, but only "Hi {pal}" counts (it interrupts), and Pal's own words heard back
// through the speaker are ignored.
import type { MicVAD } from '@ricky0123/vad-web'
import type { PalId } from './core'
import { isEcho, matchWake, wakesOtherPal } from './wake'
import { WakeEngine, type Ort } from './wakeword'

export type HandsFreeState = 'off' | 'loading' | 'listening' | 'awake' | 'thinking' | 'paused' | 'error'

export interface HandsFreeOptions {
  pal: PalId
  userName?: string
  /** Re-hear a command in the cloud for accuracy; null = use the on-device text. Not called in device-only mode. */
  transcribeCloud?: (wav: Blob) => Promise<string | null>
  deviceOnly?: boolean
  /** One command, then stop: the push-to-talk mic where the browser has no speech service (the Android app) */
  oneShot?: boolean
  /** mic: waiting for the browser's microphone permission. tap: ready, but the browser wants one tap first */
  onState: (s: HandsFreeState, info?: { progress?: number; error?: string; mic?: boolean; tap?: boolean }) => void
  /** "Hi Jhyvie" with nothing after it: Pal says "yes?" and takes the next sentence without the wake word */
  /**
   * "Hi {pal}" heard. early: the wake-word engine (or the live preview) caught it while they may still be talking, so
   * the mic-open sound and rings come now; late: they stopped after the name (open the live words); full: both at once
   */
  onWake?: (phase: 'early' | 'late' | 'full') => void
  onCommand: (text: string) => void
  /** "Hey Jhyvie" heard while another pal listens: the name they used, and the request after it ('' when none) */
  onWrongName?: (wrong: string, command: string) => void
  /** "Hi Jhyvie" while Pal was talking: stop talking now; the command (if any) follows through onWake / onCommand */
  onBargeIn?: () => void
  /** Someone started (true) or stopped (false) talking into the mic */
  onSpeech?: (talking: boolean) => void
  /** Live words while they're still talking (on-device, updated about every 1.5s); '' clears it */
  onPreview?: (text: string) => void
  /** Dev/tests only: run the loop without a microphone, fed by simulateHeard() */
  noMic?: boolean
}

const RATE = 16_000
const MAX_SECONDS = 30
const FOLLOW_UP_MS = 15_000

let vad: MicVAD | null = null
let worker: Worker | null = null
let ready: Promise<void> | null = null
let opts: HandsFreeOptions | null = null
let state: HandsFreeState = 'off'
/** Pal is talking out loud, and the line it's saying (kept after, for a clip of it that ends late) */
let speaking = false
let line = ''
/** The clip being recorded began while Pal was talking */
let startedSpeaking = false
let followUntil = 0
let lastWake = 0
let wakeLock: { release: () => Promise<void> } | null = null
let queue: Promise<void> = Promise.resolve()
let seq = 0
const waiting = new Map<number, (text: string) => void>()

/** Silence that ends a clip: short while waiting for "Hi {pal}" (wakes fast), patient once it's listening to you */
const WAKE_SILENCE_MS = 500
/** Same as the app's SEND_AFTER_SILENCE_MS: 2s of quiet after their last words sends the request */
const TALK_SILENCE_MS = 2000
let awakeTimer: ReturnType<typeof setTimeout> | undefined
const set = (s: HandsFreeState, info?: { progress?: number; error?: string; mic?: boolean; tap?: boolean }) => {
  if (vad && (s === 'awake') !== (state === 'awake')) vad.setOptions({ redemptionMs: s === 'awake' ? TALK_SILENCE_MS : WAKE_SILENCE_MS })
  // "Hi Rei" and then nothing: the window closes after FOLLOW_UP_MS (and the app plays the mic-closed sound)
  clearTimeout(awakeTimer)
  if (s === 'awake') awakeTimer = setTimeout(() => { if (state === 'awake' && !handedOff && Date.now() >= followUntil) set('listening') }, FOLLOW_UP_MS + 200)
  state = s
  opts?.onState(s, info)
}
/**
 * After "Hi {pal}", the browser's live speech recognition can take the request (words appear as you talk, like the
 * tap-to-talk mic). The detector steps aside meanwhile; anything it was still holding is dropped, never sent twice.
 */
let handedOff = false
export async function handOffListening() {
  if (!vad || handedOff) return
  handedOff = true
  followUntil = 0
  await vad.pause().catch(() => {})
}
export async function resumeListening() {
  if (!handedOff) return
  handedOff = false
  if (!vad) return
  engine?.reset()
  await vad.start().catch(() => {})
  set('listening')
}

/*
 * Live preview: while they talk, the audio so far is re-read on this device every PREVIEW_MS, so their words show
 * under the mic like tap-to-talk (in steps, not word by word). One pass at a time; the final clip still decides.
 */
const PREVIEW_MS = 1500
const PHANTOM = /^\W*(bye[- ]?bye|thank you( for watching)?|thanks for watching|you|okay|hmm+|uh+|\.+)\W*$/i
const PREVIEW_MIN_SAMPLES = RATE * 0.6
let liveFrames: Float32Array[] | null = null
/** This utterance already woke Pal from its preview: its end decides "Yes?" (just the name) or the request */
let earlyWake = false
/** …and they already stopped after the name (the live words took over): its end mustn't wake again */
let ackedWake = false
let liveSamples = 0
let previewBusy = false
let lastPreview = 0
function previewFrame(frame: Float32Array) {
  if (!liveFrames || speaking || handedOff) return
  liveFrames.push(frame.slice())
  liveSamples += frame.length
  if (previewBusy || liveSamples < PREVIEW_MIN_SAMPLES || Date.now() - lastPreview < PREVIEW_MS || liveSamples > RATE * MAX_SECONDS) return
  // The engine listens for "Hi {pal}": no need to read every passing sentence just to look for it
  if (state === 'listening' && engine?.ready) return
  const audio = new Float32Array(liveSamples)
  let at = 0
  for (const f of liveFrames) { audio.set(f, at); at += f.length }
  previewBusy = true
  lastPreview = Date.now()
  const o = opts
  // While waiting for "Hi {pal}", a short read is enough to spot it; once awake, the whole thing for the words
  const t0 = Date.now()
  const seconds = audio.length / RATE
  void hear(audio, state === 'listening' ? 12 : undefined).then((text) => {
    previewBusy = false
    if (import.meta.env.DEV) console.info(`[hf] preview ${seconds.toFixed(1)}s in ${Date.now() - t0}ms: "${text.trim()}"`)
    // "Hi Rei" caught mid-utterance: the mic-open sound and rings now, not after the clip ends and is re-read
    if (liveFrames && o && opts === o && state === 'listening' && !earlyWake && !speaking && matchWake(text, o.pal, o.userName)) {
      earlyWake = true
      lastWake = Date.now()
      followUntil = Date.now() + FOLLOW_UP_MS
      set('awake')
      o.onWake?.('early')
    }
    // Still the same utterance: show it (a finished one is shown by the final read). Whisper "hears" these in noise
    if (liveFrames && opts === o && text.trim() && !PHANTOM.test(text)) o?.onPreview?.(text.trim())
  })
}

/*
 * The wake-word engine heard "Hi {pal}": the mic-open sound, "Yes?" on screen and the rings right now. Then a quick
 * look at whether they keep talking: they stopped after the name → the live words take the request (Pal stays quiet: a
 * spoken "Yes?" talked over them); they went straight on ("Hi Rei, add gym at 5") → that utterance is the request.
 * (Whisper isn't asked to double-check: it writes these names as "Hi, TV", "OJP", "Hello, GP" too often.)
 */
let engine: WakeEngine | null = null
let ortRuntime: Ort | null = null
/** What's catching "Hi {pal}" now, for Settings */
export const wakeDetector = (): 'engine' | 'whisper' => (engine?.ready ? 'engine' : 'whisper')
/** Dev/tests: the engine's newest score */
export const wakeScore = () => engine?.lastScore ?? 0
/** What hands-free is doing, for checking a phone over USB (chrome://inspect): window.__palVoiceStatus() */
let micLevel = 0
let speechProb = 0
export const voiceStatus = () => ({ state, mic: +micLevel.toFixed(4), speech: +speechProb.toFixed(2), audio: audioContext()?.state, track: (() => { const t = (vad as unknown as { _stream?: MediaStream } | null)?._stream?.getAudioTracks()[0]; return t ? `${t.readyState}${t.muted ? ' muted' : ''}${t.enabled ? '' : ' disabled'} ${t.label}` : null })(), detector: wakeDetector(), msPerStep: engine ? Math.round(engine.msPerStep) : null, score: engine?.lastScore ?? null, isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated })
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__palVoiceStatus = voiceStatus
/** Quiet this long right after the name: they stopped, say "Yes?". Talking this long (past the name's own tail): a request */
const QUIET_MS = 250
const TALKING_ON_MS = 200
const NAME_TAIL_MS = 150
let watchQuiet = -1
let watchedMs = 0
let talkingMs = 0
let engineAt = 0
function engineWake(score: number) {
  const o = opts
  if (import.meta.env.DEV) console.info(`[wakeword] heard "Hi ${o?.pal}" (${score.toFixed(2)}) while ${state}${speaking ? ', Pal talking' : ''}`)
  // Over Pal's voice, Whisper confirms it isn't Pal's own words coming back; awake/thinking: already listening
  if (!o || state !== 'listening' || speaking || handedOff || earlyWake) return
  earlyWake = true
  ackedWake = false
  lastWake = engineAt = Date.now()
  followUntil = Date.now() + FOLLOW_UP_MS
  watchQuiet = watchedMs = talkingMs = 0
  set('awake')
  o.onWake?.('early')
}
function watchFrame(isSpeech: number, ms: number) {
  if (watchQuiet < 0) return
  if (state !== 'awake' || handedOff || !earlyWake) { watchQuiet = -1; return }
  watchedMs += ms
  if (isSpeech < 0.35) watchQuiet += ms
  else {
    watchQuiet = 0
    // Talking on past the name's own tail: a request
    if (watchedMs > NAME_TAIL_MS) talkingMs += ms
  }
  if (talkingMs >= TALKING_ON_MS || watchedMs > 1500) {
    // "Hi Rei, what's next?": a request, and the end of this utterance decides (no "Yes?" over them)
    watchQuiet = -1
    if (import.meta.env.DEV) console.info('[wakeword] they kept talking: taking it as the request')
  } else if (watchQuiet >= QUIET_MS) {
    watchQuiet = -1
    ackedWake = true
    if (import.meta.env.DEV) console.info('[wakeword] they stopped after the name: listening')
    opts?.onWake?.('late')
  }
}
/** "Yes? Add gym at 5": Pal's own "Yes?" caught at the start of the request */
function dropAck(text: string) {
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean)
  const a = words(ack)
  const t = text.trim().split(/\s+/)
  return a.length && words(t.slice(0, a.length).join(' ')).join(' ') === a.join(' ') ? t.slice(a.length).join(' ') : text
}

/** Pal's quick "Yes?" after a wake: if the mic catches it, it isn't the user's request */
let ack = ''
export function setWakeAck(text: string) { ack = text }
export const handsFreeState = () => state
/** What the device last wrote out, shown in Settings so a missed "Hi {pal}" can be seen (it never leaves the device) */
let heard = ''
export const HEARD_EVENT = 'paldo-heard'
export const lastHeard = () => heard

/** Whisper on this device, in a worker so the UI never stutters */
function loadWhisper(onProgress: (p: number) => void) {
  if (ready) return ready
  worker = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' })
  ready = new Promise<void>((resolve, reject) => {
    worker!.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') onProgress(m.progress)
      else if (m.type === 'ready') resolve()
      else if (m.type === 'text') waiting.get(m.id)?.(m.text)
      else if (m.type === 'error') {
        if (m.id != null) waiting.get(m.id)?.('')
        else reject(new Error(m.error))
      }
      if (m.id != null) waiting.delete(m.id)
    }
    worker!.onerror = (e) => reject(new Error(e.message))
    worker!.postMessage({ type: 'load' })
  }).catch((err) => {
    ready = null
    worker?.terminate()
    worker = null
    throw err
  })
  return ready
}

/** maxTokens: stop after that many words-ish (a preview only needs to spot "Hi {pal}", and it's much faster) */
function hear(audio: Float32Array, maxTokens?: number): Promise<string> {
  if (!worker) return Promise.resolve('')
  const id = ++seq
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker!.postMessage({ type: 'transcribe', id, audio, maxTokens }, [audio.buffer])
  })
}

/** 16-bit PCM WAV, what Groq's Whisper accepts */
export function encodeWav(samples: Float32Array, rate = RATE): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return new Blob([buf], { type: 'audio/wav' })
}

/**
 * Where the voice detector's ONNX runtime lives: the copy Kokoro already ships in /public/kokoro/ort. The glue
 * script is loaded through a blob URL because Vite's dev server refuses to import public files as modules, and with
 * one thread it needs no helper workers. Same path in dev, the web build and the Android app.
 */
let ortPaths: Promise<{ mjs: string; wasm: string }> | null = null
export function vadOrtConfig() {
  const dir = import.meta.env.BASE_URL + 'kokoro/ort/'
  ortPaths ??= fetch(dir + 'ort-wasm-simd-threaded.jsep.mjs')
    .then((r) => r.text())
    .then((src) => ({ mjs: URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), wasm: dir + 'ort-wasm-simd-threaded.jsep.wasm' }))
  return ortPaths
}

/** The best text for a clip that's meant for Pal: the cloud's when allowed, else what the device heard */
async function bestText(audio: Float32Array, local: string): Promise<string> {
  if (!opts?.transcribeCloud || opts.deviceOnly) return local
  return (await opts.transcribeCloud(encodeWav(audio))) ?? local
}

/** One utterance, in order: a second sentence never overtakes the first. overPal: it began while Pal was talking. */
async function handle(audio: Float32Array, overPal: boolean) {
  const o = opts
  if (!o || handedOff) return
  const clip = audio.length > RATE * MAX_SECONDS ? audio.slice(0, RATE * MAX_SECONDS) : audio
  const followUp = !overPal && (o.oneShot || Date.now() < followUntil)
  if (!overPal && !earlyWake) set('thinking')
  const t0 = Date.now()
  const local = await hear(clip.slice())
  if (import.meta.env.DEV) console.info(`[hf] read ${(clip.length / RATE).toFixed(1)}s of audio in ${Date.now() - t0}ms: "${local.trim()}"`)
  if (opts !== o || handedOff) return
  heard = local.trim()
  window.dispatchEvent(new Event(HEARD_EVENT))
  // The finished read replaces the step-by-step preview
  if (!overPal) o.onPreview?.(heard)
  if (overPal) return interrupt(o, local, clip)
  await route(o, local, clip, followUp)
}

/** Heard while Pal was talking: only "Hi {pal}" that isn't Pal's own voice coming back stops it */
async function interrupt(o: HandsFreeOptions, local: string, clip: Float32Array | null) {
  if (!matchWake(local, o.pal, o.userName) || isEcho(local, line, o.pal)) return
  speaking = false
  line = ''
  o.onBargeIn?.()
  await route(o, local, clip, false)
}

/** What the device heard → wake, follow-up, or dropped. `clip` null: text only (tests), no cloud re-hearing. */
async function route(o: HandsFreeOptions, local: string, clip: Float32Array | null, followUp: boolean) {
  const best = (fallback: string) => (clip ? bestText(clip, fallback) : Promise.resolve(fallback))
  // Right after "Hi Jhyvie…" or a question from Pal: this sentence is for Pal, no wake word needed
  if (followUp) {
    // Pal's own "Yes?" coming back through the mic: keep waiting for the real request
    if (ack && isEcho(local, ack, o.pal)) { ack = ''; return set('awake') }
    // "Hi Rei" again (nothing seemed to happen): wake again, don't send "Hi Rei" to Pal as the request.
    // After an early wake it's the same "Hi Rei" finishing: now say "Yes?" and listen for the request
    const again = matchWake(local, o.pal, o.userName)
    const early = earlyWake
    const acked = ackedWake
    earlyWake = ackedWake = false
    if (again && (!again.command || (ack && isEcho(again.command, ack, o.pal)))) {
      lastWake = Date.now()
      followUntil = Date.now() + FOLLOW_UP_MS
      set('awake')
      // The engine's wake already said "Yes?" for this one: just keep listening
      if (acked) return
      return o.onWake?.(early ? 'late' : 'full')
    }
    // Silence or noise that Whisper "heard" as "Thank you." / "Bye-bye.": not a request, keep listening
    if (PHANTOM.test(local)) { followUntil = Date.now() + FOLLOW_UP_MS; return set('awake') }
    followUntil = 0
    const text = (await best(local)).trim()
    if (o.oneShot) await stopHandsFree()
    else set('listening')
    const command = acked ? dropAck(matchWake(text, o.pal, o.userName)?.command || text) : matchWake(text, o.pal, o.userName)?.command || text
    if (import.meta.env.DEV) console.info(`[hf] request: "${command}"`)
    if (command.trim()) o.onCommand(command)
    return
  }

  const wake = matchWake(local, o.pal, o.userName)
  if (!wake) {
    // "Hey Jhyvie" while Rei listens: Rei says who it is, then takes the request anyway
    const other = o.onWrongName ? wakesOtherPal(local, o.pal, o.userName) : null
    set('listening')
    if (!other) o.onPreview?.('') // not for Pal: don't leave it on screen
    if (other) {
      lastWake = Date.now()
      if (!other.command) followUntil = Date.now() + FOLLOW_UP_MS
      // Same as a real wake: the cloud re-hears the request, and keeps what came after the name
      const command = other.command ? wakesOtherPal(await best(local), o.pal, o.userName)?.command || other.command : ''
      o.onWrongName!(other.wrong, command)
    }
    return // not for Pal: dropped right here
  }
  lastWake = Date.now()
  if (!wake.command) {
    followUntil = Date.now() + FOLLOW_UP_MS
    set('awake')
    o.onPreview?.('')
    return o.onWake?.('full')
  }
  // The cloud re-hears the whole clip, wake phrase included; keep what came after the name
  const heard = await best(local)
  const command = matchWake(heard, o.pal, o.userName)?.command || wake.command
  set('listening')
  o.onCommand(command)
}

async function keepScreenOn() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null
  } catch {}
}
const onVisible = () => { if (document.visibilityState === 'visible' && vad && !wakeLock) keepScreenOn() }

/** The detector's audio. MicVAD keeps it private, but it's what a browser suspends until the first tap */
const audioContext = () => (vad as unknown as { _audioContext?: AudioContext } | null)?._audioContext
/** The first tap after a load: let the audio run (hands-free started on its own, before any tap) */
export async function resumeAudio() {
  const ctx = audioContext()
  if (!ctx || ctx.state !== 'suspended') return
  await ctx.resume().catch(() => {})
  if ((ctx.state as AudioContextState) === 'running' && state === 'loading') set(opts?.oneShot ? 'awake' : 'listening')
}

/** A start still loading: a second start (the tap that turned it on + the "resume on first tap" one) joins it */
let starting: Promise<void> | null = null

/** Start listening (asks for the mic). Call from a tap: browsers only allow audio after one. */
export async function startHandsFree(o: HandsFreeOptions) {
  if (starting) {
    // Two starts at once used to leave a listener that was never started: the app said "on" but heard nothing
    opts = o
    return starting
  }
  if (vad) {
    opts = o
    engine?.setPal(o.pal).catch(() => {})
    return set(speaking ? 'paused' : 'listening')
  }
  starting = begin(o).finally(() => { starting = null })
  return starting
}

async function begin(o: HandsFreeOptions) {
  opts = o
  speaking = false
  followUntil = o.oneShot ? Date.now() + 60_000 : 0
  set('loading', { progress: 0 })
  try {
    if (o.noMic) {
      // Tests: the same loop and states, with heard text injected instead of a microphone
      vad = { start: async () => {}, pause: async () => {}, destroy: async () => {} } as unknown as MicVAD
      lastWake = Date.now()
      return set('listening')
    }
    // The mic first, right on the tap: Chrome's permission prompt shows now, and while it waits the app says so
    // (it used to load the model first and then sit at "Getting ready… 100%" behind an unanswered prompt)
    const micAudio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    set('loading', { progress: 0, mic: true })
    let firstStream: MediaStream | null = await navigator.mediaDevices.getUserMedia({ audio: micAudio })
    if (!opts) { firstStream.getTracks().forEach((t) => t.stop()); return }
    set('loading', { progress: 0 })
    // The speech model and the voice detector load side by side (one after the other added ~5s)
    const whisper = loadWhisper((p) => opts != null && set('loading', { progress: p }))
    whisper.catch(() => {}) // reported where it's awaited below
    const { MicVAD } = await import('@ricky0123/vad-web')
    const base = import.meta.env.BASE_URL
    const paths = await vadOrtConfig()
    vad = await MicVAD.new({
      startOnLoad: false, // started below, once the speech model is ready too
      model: 'v5',
      baseAssetPath: base + 'vad/',
      onnxWASMBasePath: base + 'kokoro/ort/',
      ortConfig: (ort) => {
        ortRuntime = ort
        ort.env.wasm.wasmPaths = paths
        ort.env.wasm.numThreads = 1
      },
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: WAKE_SILENCE_MS, // TALK_SILENCE_MS (2s) once awake: 0.8s cut people off mid-thought
      preSpeechPadMs: 300,
      minSpeechMs: 250,
      // The stream the tap already opened, then fresh ones after a pause
      getStream: async () => { const s = firstStream ?? (await navigator.mediaDevices.getUserMedia({ audio: micAudio })); firstStream = null; return s },
      onFrameProcessed: (probs: { isSpeech: number }, frame: Float32Array) => {
        let sum = 0
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
        micLevel = Math.max(Math.sqrt(sum / frame.length), micLevel * 0.9)
        speechProb = probs.isSpeech
        engine?.push(frame)
        watchFrame(probs.isSpeech, (frame.length / RATE) * 1000)
        previewFrame(frame)
      },
      onSpeechStart: () => {
        liveFrames = []
        // A wake the engine caught just before the voice detector noticed speech belongs to this utterance
        if (Date.now() - engineAt > 1500) earlyWake = ackedWake = false
        opts?.onSpeech?.(true)
        liveSamples = 0
        lastPreview = Date.now() - PREVIEW_MS + 700 // first words after ~0.7s
        startedSpeaking = speaking
        if (!speaking && opts) set(Date.now() < followUntil || opts.oneShot ? 'awake' : 'listening')
      },
      onVADMisfire: () => { liveFrames = null; opts?.onPreview?.(''); opts?.onSpeech?.(false) },
      onSpeechEnd: (audio: Float32Array) => {
        if (import.meta.env.DEV) console.info(`[hf] utterance ended (${(audio.length / RATE).toFixed(1)}s)`)
        liveFrames = null
        opts?.onSpeech?.(false)
        // A clip that began while Pal talked is judged as heard over Pal, even if it ends after
        const overPal = startedSpeaking || speaking
        queue = queue.then(() => handle(audio, overPal)).catch(() => {})
      },
    })
    // The wake-word engine on the same runtime; without it, Whisper is the wake detector (slower, still works)
    const wakeLoad = ortRuntime
      ? WakeEngine.load(ortRuntime, o.pal, engineWake).then((e) => { if (vad) engine = e; else e.dispose() }, (err) => console.warn('[wakeword] not loaded, Whisper listens for the name:', err))
      : Promise.resolve()
    await whisper
    await wakeLoad
    if (!opts) { // stopped while loading
      const v = vad
      vad = null
      await v.destroy().catch(() => {})
      return
    }
    await vad.start()
    lastWake = Date.now()
    keepScreenOn()
    document.addEventListener('visibilitychange', onVisible)
    // Started without a tap (on load): the browser may hold the audio until the first one
    if (audioContext()?.state === 'suspended') return set('loading', { tap: true })
    // The newest start's settings win (it may have joined while this one loaded)
    set(opts.oneShot ? 'awake' : 'listening')
  } catch (err) {
    const e = err as Error & { name?: string }
    await stopHandsFree(false)
    set('error', { error: e?.name === 'NotAllowedError' ? 'mic-blocked' : e?.name === 'NotFoundError' ? 'no-mic' : String(e?.message ?? err) })
  }
}

export async function stopHandsFree(report = true) {
  const v = vad
  vad = null
  handedOff = false
  followUntil = 0
  clearTimeout(awakeTimer)
  engine?.dispose()
  engine = null
  watchQuiet = -1
  document.removeEventListener('visibilitychange', onVisible)
  wakeLock?.release().catch(() => {})
  wakeLock = null
  await v?.destroy().catch(() => {})
  if (report) set('off')
  opts = null
}

/**
 * Pal started or stopped talking out loud (`text`: what it's saying). Listening goes on, but only "Hi {pal}"
 * counts while it talks, and its own words heard back are ignored.
 */
export function setPalSpeaking(on: boolean, text = '') {
  if (on) line = text
  if (!vad || speaking === on) return
  speaking = on
  set(on ? 'paused' : Date.now() < followUntil ? 'awake' : 'listening')
}

/** Pal just asked something ("Add this?"): take the next sentence without the wake word */
export function expectFollowUp(ms = FOLLOW_UP_MS) {
  if (!vad) return
  followUntil = Date.now() + ms
  if (!speaking) set('awake')
}

export const isHandsFreeOn = () => vad != null

/** Dev/tests: as if the device just heard this sentence (skips the audio stage) */
export function simulateHeard(text: string) {
  const o = opts
  if (!o) return Promise.resolve()
  if (speaking) return (queue = queue.then(() => interrupt(o, text, null)).catch(() => {}))
  const followUp = !!o.oneShot || Date.now() < followUntil
  return (queue = queue.then(() => route(o, text, null, followUp)).catch(() => {}))
}
