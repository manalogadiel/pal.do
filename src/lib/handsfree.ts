// Hands-free "Hi Jhyvie". Listens on this device, works out when you've stopped talking, and wakes only on
// "hi/hey + the pal's name". Nothing leaves the device unless that wake phrase was heard.
//
//   mic → Silero voice detector (one clip per utterance, ends after ~0.8s of silence)
//       → Whisper tiny on this device → matchWake(): not for Pal? dropped, never sent anywhere
//       → the command: Groq's Whisper re-hears just that clip when allowed (better Taglish), else the device's text
import type { MicVAD } from '@ricky0123/vad-web'
import type { PalId } from './core'
import { matchWake } from './wake'

export type HandsFreeState = 'off' | 'loading' | 'listening' | 'awake' | 'thinking' | 'paused' | 'error'

export interface HandsFreeOptions {
  pal: PalId
  userName?: string
  /** Re-hear a command in the cloud for accuracy; null = use the on-device text. Not called in device-only mode. */
  transcribeCloud?: (wav: Blob) => Promise<string | null>
  deviceOnly?: boolean
  /** One command, then stop: the push-to-talk mic where the browser has no speech service (the Android app) */
  oneShot?: boolean
  onState: (s: HandsFreeState, info?: { progress?: number; error?: string }) => void
  /** "Hi Jhyvie" with nothing after it: Pal says "yes?" and takes the next sentence without the wake word */
  onWake?: () => void
  onCommand: (text: string) => void
  /** Turned itself off: no wake for 30 minutes */
  onIdle?: () => void
  /** Dev/tests only: run the loop without a microphone, fed by simulateHeard() */
  noMic?: boolean
}

const RATE = 16_000
const MAX_SECONDS = 15
const FOLLOW_UP_MS = 8_000
const IDLE_OFF_MS = 30 * 60_000

let vad: MicVAD | null = null
let worker: Worker | null = null
let ready: Promise<void> | null = null
let opts: HandsFreeOptions | null = null
let state: HandsFreeState = 'off'
let paused = false
let followUntil = 0
let lastWake = 0
let idleCheck: ReturnType<typeof setInterval> | null = null
let wakeLock: { release: () => Promise<void> } | null = null
let queue: Promise<void> = Promise.resolve()
let seq = 0
const waiting = new Map<number, (text: string) => void>()

const set = (s: HandsFreeState, info?: { progress?: number; error?: string }) => {
  state = s
  opts?.onState(s, info)
}
export const handsFreeState = () => state

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

function hear(audio: Float32Array): Promise<string> {
  if (!worker) return Promise.resolve('')
  const id = ++seq
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    worker!.postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
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

/** The best text for a clip that's meant for Pal: the cloud's when allowed, else what the device heard */
async function bestText(audio: Float32Array, local: string): Promise<string> {
  if (!opts?.transcribeCloud || opts.deviceOnly) return local
  return (await opts.transcribeCloud(encodeWav(audio))) ?? local
}

/** One utterance, in order: a second sentence never overtakes the first */
async function handle(audio: Float32Array) {
  const o = opts
  if (!o || paused) return
  const clip = audio.length > RATE * MAX_SECONDS ? audio.slice(0, RATE * MAX_SECONDS) : audio
  const followUp = o.oneShot || Date.now() < followUntil
  set('thinking')
  const local = await hear(clip.slice())
  if (opts !== o || paused) return
  await route(o, local, clip, followUp)
}

/** What the device heard → wake, follow-up, or dropped. `clip` null: text only (tests), no cloud re-hearing. */
async function route(o: HandsFreeOptions, local: string, clip: Float32Array | null, followUp: boolean) {
  const best = (fallback: string) => (clip ? bestText(clip, fallback) : Promise.resolve(fallback))
  // Right after "Hi Jhyvie…" or a question from Pal: this sentence is for Pal, no wake word needed
  if (followUp) {
    followUntil = 0
    const text = (await best(local)).trim()
    if (o.oneShot) await stopHandsFree()
    else set('listening')
    if (text) o.onCommand(matchWake(text, o.pal, o.userName)?.command || text)
    return
  }

  const wake = matchWake(local, o.pal, o.userName)
  if (!wake) return set('listening') // not for Pal: dropped right here
  lastWake = Date.now()
  if (!wake.command) {
    followUntil = Date.now() + FOLLOW_UP_MS
    set('awake')
    return o.onWake?.()
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

/** Start listening (asks for the mic). Call from a tap: browsers only allow audio after one. */
export async function startHandsFree(o: HandsFreeOptions) {
  if (vad) {
    opts = o
    return set(paused ? 'paused' : 'listening')
  }
  opts = o
  paused = false
  followUntil = o.oneShot ? Date.now() + 60_000 : 0
  set('loading', { progress: 0 })
  try {
    if (o.noMic) {
      // Tests: the same loop and states, with heard text injected instead of a microphone
      vad = { start: async () => {}, pause: async () => {}, destroy: async () => {} } as unknown as MicVAD
      lastWake = Date.now()
      return set('listening')
    }
    await loadWhisper((p) => opts === o && set('loading', { progress: p }))
    const { MicVAD } = await import('@ricky0123/vad-web')
    const base = import.meta.env.BASE_URL
    vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: base + 'vad/',
      onnxWASMBasePath: base + 'kokoro/ort/',
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      redemptionMs: 800, // ~0.8s of silence = you've finished the sentence
      preSpeechPadMs: 300,
      minSpeechMs: 250,
      getStream: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      onSpeechStart: () => { if (!paused && opts) set(Date.now() < followUntil || opts.oneShot ? 'awake' : 'listening') },
      onSpeechEnd: (audio: Float32Array) => { queue = queue.then(() => handle(audio)).catch(() => {}) },
    })
    if (opts !== o) return // stopped while loading
    await vad.start()
    lastWake = Date.now()
    idleCheck = setInterval(() => {
      if (!o.oneShot && Date.now() - lastWake > IDLE_OFF_MS) {
        stopHandsFree()
        o.onIdle?.()
      }
    }, 60_000)
    keepScreenOn()
    document.addEventListener('visibilitychange', onVisible)
    set(o.oneShot ? 'awake' : 'listening')
  } catch (err) {
    const e = err as Error & { name?: string }
    await stopHandsFree(false)
    set('error', { error: e?.name === 'NotAllowedError' ? 'mic-blocked' : e?.name === 'NotFoundError' ? 'no-mic' : String(e?.message ?? err) })
  }
}

export async function stopHandsFree(report = true) {
  const v = vad
  vad = null
  followUntil = 0
  if (idleCheck) clearInterval(idleCheck)
  idleCheck = null
  document.removeEventListener('visibilitychange', onVisible)
  wakeLock?.release().catch(() => {})
  wakeLock = null
  await v?.destroy().catch(() => {})
  if (report) set('off')
  opts = null
}

/** While Pal is talking: don't listen, so it never hears itself */
export function pauseListening(p: boolean) {
  if (!vad || paused === p) return
  paused = p
  if (p) vad.pause().catch(() => {})
  else vad.start().catch(() => {})
  set(p ? 'paused' : Date.now() < followUntil ? 'awake' : 'listening')
}

/** Pal just asked something ("Add this?"): take the next sentence without the wake word */
export function expectFollowUp(ms = FOLLOW_UP_MS) {
  if (!vad) return
  followUntil = Date.now() + ms
  if (!paused) set('awake')
}

export const isHandsFreeOn = () => vad != null

/** Dev/tests: as if the device just heard this sentence (skips the audio stage) */
export function simulateHeard(text: string) {
  const o = opts
  if (!o || paused) return Promise.resolve()
  const followUp = !!o.oneShot || Date.now() < followUntil
  return (queue = queue.then(() => route(o, text, null, followUp)).catch(() => {}))
}

/** Dev/tests: the on-device Whisper on a 16 kHz clip */
export async function transcribeOnDevice(audio: Float32Array) {
  await loadWhisper(() => {})
  return hear(audio)
}
