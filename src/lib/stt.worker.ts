/// <reference lib="webworker" />
// Whisper on this device: hears "Hi Jhyvie" without sending any audio anywhere.
// Model files come from /public/whisper, and the ONNX runtime is the one Kokoro already ships in /public/kokoro/ort.
// Base, not tiny: on the voice self-test (10 Kokoro clips) base caught every "Hi Jhyvie", tiny missed 2, at ~2.9s vs
// ~1.4s a clip on a laptop. The self-test can load another size ({ type: 'load', model: 'tiny' }) to compare again;
// sizes not in /public come from Hugging Face.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

/** The size the app ships, in /public/whisper */
const SHIPPED = 'base'
let size = SHIPPED
const BASE = self.location.origin + import.meta.env.BASE_URL
const HF_ROOT = 'https://huggingface.co/onnx-community/'

// The library asks huggingface.co for files; answer from our own copies (offline, and inside the APK).
// If the copy is missing or the host hands back HTML instead of the file, fall back to Hugging Face itself.
const net = self.fetch.bind(self)
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const hf = `${HF_ROOT}whisper-${size}/resolve/main/`
  if (!url.startsWith(hf)) return net(input, init)
  const rest = url.slice(hf.length).split('?')[0]
  try {
    const r = await net(`${BASE}${size === SHIPPED ? 'whisper' : `whisper-${size}`}/${rest}`, init)
    const type = r.headers.get('content-type') || ''
    if (r.ok && !type.includes('text/html')) return r
  } catch {}
  return net(url, init)
}
env.allowLocalModels = false
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = BASE + 'kokoro/ort/'
  // Every core when the page is cross-origin isolated (the server headers allow it): several times faster on a laptop.
  // Without isolation (the Android app) it stays on one thread, as before
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)) : 1
  if (import.meta.env.DEV && !self.crossOriginIsolated) console.warn('[hands-free] page is not cross-origin isolated: speech-to-text runs on one core (~3x slower). Check the server headers.')
}

// pipeline()'s overloads are too big for TypeScript to resolve; this is the one we use
const asrPipeline = pipeline as unknown as (task: 'automatic-speech-recognition', model: string, opts: object) => Promise<AutomaticSpeechRecognitionPipeline>
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null
const load = () =>
  (asr ??= asrPipeline('automatic-speech-recognition', `onnx-community/whisper-${size}`, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === 'progress' && p.progress != null) self.postMessage({ type: 'progress', progress: p.progress / 100 })
    },
  }))

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      if (m.model && !asr) size = m.model
      await load()
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'transcribe') {
      const t = await load()
      // Wake names use English; an awake Jhyvie request uses Tagalog transcription, never translation.
      const lang = size.endsWith('.en') ? {} : { language: m.language ?? 'english', task: 'transcribe' }
      const out = (await t(m.audio as Float32Array, { ...lang, ...(m.maxTokens ? { max_new_tokens: m.maxTokens } : {}) })) as { text: string }
      self.postMessage({ type: 'text', id: m.id, text: (out.text ?? '').trim() })
    }
  } catch (err) {
    if (m.type === 'load') asr = null
    self.postMessage({ type: 'error', id: m.id, error: String(err) })
  }
}
