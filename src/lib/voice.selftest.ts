// Dev-only audio test for hands-free, no human needed: Kokoro (the on-device voice) speaks a sentence, and that sound
// goes through the real pipeline: voice detection → on-device Whisper → wake check → command parser.
// Run from the browser console or Playwright: await window.__palVoiceTest()
import { parseCommand } from './commands'
import type { PalId } from './core'
import { transcribeOnDevice } from './handsfree'
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

export interface VoiceTestResult {
  phrase: string
  voice: string
  segments: number
  heard: string
  wake: { command: string } | null
  command: ReturnType<typeof parseCommand>
}

export async function runVoiceSelfTest(
  phrases = [
    'Hi Jhyvie, set me a timer for five minutes and remind me the last thirty seconds.',
    "Hi Jhyvie, what's next?",
    'I think we should buy groceries later.',
  ],
  voices = ['af_bella', 'am_michael'],
  pal: PalId = 'jhyvie',
): Promise<VoiceTestResult[]> {
  const tts = kokoro()
  const { NonRealTimeVAD } = await import('@ricky0123/vad-web')
  const base = import.meta.env.BASE_URL
  // The offline detector runs Silero's legacy model (dev server serves it from node_modules); the end-of-speech
  // logic (redemptionMs) is the same one the live listener uses
  const vad = await NonRealTimeVAD.new({
    modelURL: base + 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx',
    ortConfig: (ort) => { ort.env.wasm.wasmPaths = base + 'kokoro/ort/' },
    redemptionMs: 800,
  })
  const results: VoiceTestResult[] = []
  try {
    for (const phrase of phrases) {
      for (const voice of voices) {
        const { audio, rate } = await tts.speak(phrase, voice)
        const clip = withSilence(to16k(audio, rate))
        // The detector must find exactly one utterance and know where it ends
        const segments: Float32Array[] = []
        for await (const seg of vad.run(clip, RATE)) segments.push(seg.audio)
        const heard = segments.length ? await transcribeOnDevice(segments[0].slice()) : ''
        const wake = matchWake(heard, pal)
        results.push({ phrase, voice, segments: segments.length, heard, wake, command: wake?.command ? parseCommand(wake.command, Date.now()) : null })
      }
    }
  } finally {
    tts.close()
  }
  return results
}
