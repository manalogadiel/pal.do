/// <reference lib="webworker" />
// Whisper (tiny) on this device: hears "Hi Jhyvie" without sending any audio anywhere.
// Model files come from /public/whisper, and the ONNX runtime is the one Kokoro already ships in /public/kokoro/ort.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

const MODEL = 'onnx-community/whisper-tiny'
const BASE = self.location.origin + import.meta.env.BASE_URL
const LOCAL = BASE + 'whisper/'
const HF = `https://huggingface.co/${MODEL}/resolve/main/`

// The library asks huggingface.co for files; answer from our own copies (offline, and inside the APK).
// If the copy is missing or the host hands back HTML instead of the file, fall back to Hugging Face itself.
const net = self.fetch.bind(self)
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith(HF)) return net(input, init)
  const rest = url.slice(HF.length).split('?')[0]
  try {
    const r = await net(LOCAL + rest, init)
    const type = r.headers.get('content-type') || ''
    if (r.ok && !type.includes('text/html')) return r
  } catch {}
  return net(url, init)
}
env.allowLocalModels = false
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = BASE + 'kokoro/ort/'

// pipeline()'s overloads are too big for TypeScript to resolve; this is the one we use
const asrPipeline = pipeline as unknown as (task: 'automatic-speech-recognition', model: string, opts: object) => Promise<AutomaticSpeechRecognitionPipeline>
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null
const load = () =>
  (asr ??= asrPipeline('automatic-speech-recognition', MODEL, {
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
      await load()
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'transcribe') {
      const t = await load()
      // English decoding keeps names like "Jhyvie" close to how they sound; Taglish words come out phonetically
      const out = (await t(m.audio as Float32Array, { language: 'english', task: 'transcribe' })) as { text: string }
      self.postMessage({ type: 'text', id: m.id, text: (out.text ?? '').trim() })
    }
  } catch (err) {
    if (m.type === 'load') asr = null
    self.postMessage({ type: 'error', id: m.id, error: String(err) })
  }
}
