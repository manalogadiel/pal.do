// Dev-only audio test for hands-free, no human needed: Kokoro (the on-device voice) speaks a sentence, and that sound
// goes through the real pipeline: voice detection → on-device Whisper → wake check → command parser.
// Run from the browser console or Playwright: await window.__palVoiceTest()
//   { models: ['base', 'tiny'] } compares on-device Whisper sizes on the same clips (the app ships base; others download)
//   { cloud: true } also sends each clip that woke Pal to Groq's Whisper (a few seconds of the free audio quota)
import { parseCommand } from './commands'
import type { PalId } from './core'
import { transcribeGroq } from './groq'
import { encodeWav, vadOrtConfig } from './handsfree'
import { matchWake } from './wake'

const RATE = 16_000

function kokoro() {
  const w = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' })
  let id = 0
  const ready = new Promise<void>((ok, fail) => {
    w.addEventListener('message', (e) => { if (e.data.type === 'ready') ok(); else if (e.data.type === 'error' && e.data.id == null) fail(new Error(e.data.error)) })
  })
  w.postMessage({ type: 'load' })
  const speak = async (text: string, voice: string) => {
    await ready
    const my = ++id
    return new Promise<{ audio: Float32Array; rate: number }>((ok, fail) => {
      const on = (e: MessageEvent) => {
        if (e.data.id !== my) return
        w.removeEventListener('message', on)
        if (e.data.type === 'audio') ok({ audio: e.data.audio, rate: e.data.rate })
        else fail(new Error(e.data.error))
      }
      w.addEventListener('message', on)
      w.postMessage({ type: 'speak', id: my, text, voice, speed: 1 })
    })
  }
  return { speak, close: () => w.terminate() }
}

/** On-device Whisper of one size, in its own worker (the same worker file the app uses) */
function whisper(model: WhisperSize) {
  const w = new Worker(new URL('./stt.worker.ts', import.meta.url), { type: 'module' })
  let id = 0
  const ready = new Promise<void>((ok, fail) => {
    w.addEventListener('message', (e) => { if (e.data.type === 'ready') ok(); else if (e.data.type === 'error' && e.data.id == null) fail(new Error(e.data.error)) })
  })
  w.postMessage({ type: 'load', model })
  const hear = async (audio: Float32Array) => {
    await ready
    const my = ++id
    return new Promise<string>((ok) => {
      const on = (e: MessageEvent) => {
        if (e.data.id !== my) return
        w.removeEventListener('message', on)
        ok(e.data.type === 'text' ? e.data.text : '')
      }
      w.addEventListener('message', on)
      w.postMessage({ type: 'transcribe', id: my, audio }, [audio.buffer])
    })
  }
  return { ready, hear, close: () => w.terminate() }
}

/** Linear resample to 16 kHz, what the voice detector and Whisper expect */
function to16k(audio: Float32Array, rate: number) {
  if (rate === RATE) return audio
  const out = new Float32Array(Math.floor((audio.length * RATE) / rate))
  for (let i = 0; i < out.length; i++) {
    const x = (i * rate) / RATE, j = Math.floor(x), f = x - j
    out[i] = (audio[j] ?? 0) * (1 - f) + (audio[j + 1] ?? 0) * f
  }
  return out
}

/** [silence][speech][silence], like a real pause before and after talking */
function withSilence(speech: Float32Array, before = 0.6, after = 1.5) {
  const out = new Float32Array(Math.round((before + after) * RATE) + speech.length)
  out.set(speech, Math.round(before * RATE))
  return out
}

export type WhisperSize = 'tiny' | 'base'

export interface VoiceTestResult {
  phrase: string
  voice: string
  /** Should this phrase wake Pal? */
  forPal: boolean
  segments: number
  /** What each Whisper size heard, how long it took, and what Pal made of it */
  byModel: Record<string, { heard: string; ms: number; wake: { command: string } | null; command: ReturnType<typeof parseCommand>; right: boolean }>
  /** Groq's Whisper on the same clip, when { cloud: true } and the clip woke Pal */
  cloud?: string | null
}

/** What Kokoro says, and the command Pal should end up with (null: not for Pal, or a wake with no device command) */
const PHRASES: [string, string | null][] = [
  ['Hi Jhyvie, set me a timer for five minutes and remind me the last thirty seconds.', 'setTimer'],
  ["Hi Jhyvie, what's next?", 'next'],
  ['I think we should buy groceries later.', null],
  ['Hey Jhyvie, pause the timer.', null],
  ['Hi Jhyvie, remind me at three pm to call mom.', 'setReminder'],
]

export async function runVoiceSelfTest(
  o: { phrases?: [string, string | null][]; voices?: string[]; pal?: PalId; models?: WhisperSize[]; cloud?: boolean } = {},
): Promise<{ results: VoiceTestResult[]; summary: Record<string, { right: number; total: number; avgMs: number }> }> {
  const { phrases = PHRASES, voices = ['af_bella', 'am_michael'], pal = 'jhyvie', models = ['base'], cloud = false } = o
  const tts = kokoro()
  const { NonRealTimeVAD } = await import('@ricky0123/vad-web')
  const base = import.meta.env.BASE_URL
  // The offline detector runs Silero's legacy model (dev server serves it from node_modules); the end-of-speech
  // logic (redemptionMs) is the same one the live listener uses
  const paths = await vadOrtConfig()
  const vad = await NonRealTimeVAD.new({
    modelURL: base + 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
    ortConfig: (ort) => {
      ort.env.wasm.wasmPaths = paths
      ort.env.wasm.numThreads = 1
    },
    redemptionMs: 800,
  })
  const ears = models.map((m) => [m, whisper(m)] as const)
  await Promise.all(ears.map(([, e]) => e.ready))
  const results: VoiceTestResult[] = []
  try {
    for (const [phrase, want] of phrases) {
      const forPal = matchWake(phrase, pal) != null
      for (const voice of voices) {
        const { audio, rate } = await tts.speak(phrase, voice)
        const clip = withSilence(to16k(audio, rate))
        // The detector must find exactly one utterance and know where it ends
        const segments: Float32Array[] = []
        for await (const seg of vad.run(clip, RATE)) segments.push(seg.audio)
        const byModel: VoiceTestResult['byModel'] = {}
        for (const [m, ear] of ears) {
          const t0 = performance.now()
          const heard = segments.length ? await ear.hear(segments[0].slice()) : ''
          const ms = Math.round(performance.now() - t0)
          const wake = matchWake(heard, pal)
          const command = wake?.command ? parseCommand(wake.command, Date.now()) : null
          byModel[m] = { heard, ms, wake, command, right: forPal ? !!wake && (command?.type ?? null) === want : !wake }
        }
        const woke = Object.values(byModel).some((r) => r.wake)
        const r: VoiceTestResult = { phrase, voice, forPal, segments: segments.length, byModel }
        if (cloud && woke && segments.length) r.cloud = await transcribeGroq(encodeWav(segments[0]), `Jhyvie, timer, reminder, bukas, mamaya, Taglish`)
        results.push(r)
      }
    }
  } finally {
    tts.close()
    ears.forEach(([, e]) => e.close())
  }
  const summary = Object.fromEntries(models.map((m) => {
    const rs = results.map((r) => r.byModel[m])
    return [m, { right: rs.filter((r) => r.right).length, total: rs.length, avgMs: Math.round(rs.reduce((a, r) => a + r.ms, 0) / Math.max(1, rs.length)) }]
  }))
  return { results, summary }
}
