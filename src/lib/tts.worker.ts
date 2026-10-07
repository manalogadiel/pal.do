/// <reference lib="webworker" />
// Kokoro TTS, fully offline: model, voices and ORT wasm are served from /public/kokoro.
import { KokoroTTS, env } from 'kokoro-web'

const LOCAL = self.location.origin + import.meta.env.BASE_URL + 'kokoro/'
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/'

// The library asks huggingface.co for files; answer from our own copies instead.
// If the host hands back something that isn't the file (HTML fallback, truncated), use HF itself.
const net = self.fetch.bind(self)
self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith(HF)) return net(input, init)
  const rest = url.slice(HF.length).split('?')[0]
  const local = rest.startsWith('voices/') ? LOCAL + rest : LOCAL + 'models/onnx-community/Kokoro-82M-v1.0-ONNX/' + rest
  try {
    const r = await net(local, { ...init, cache: 'no-store' })
    const type = r.headers.get('content-type') || ''
    if (r.ok && !(type.includes('text/html') && !rest.endsWith('.html'))) return r
    console.warn('[kokoro] local copy unusable, using network:', rest, r.status, type)
  } catch (e) {
    console.warn('[kokoro] local fetch failed, using network:', rest, e)
  }
  return net(url, init)
}
// A bad response cached by an earlier attempt would keep failing to parse; start clean.
const fresh = self.caches?.delete('transformers-cache').catch(() => false)
env.wasmPaths = LOCAL + 'ort/'

let tts: Promise<KokoroTTS> | null = null
const load = () => (tts ??= Promise.resolve(fresh).then(() => KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm' })))

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      await load()
      self.postMessage({ type: 'ready' })
    } else if (m.type === 'speak') {
      const t = await load()
      const out = await t.generate(m.text, { voice: m.voice, speed: m.speed ?? 1 })
      const audio = out.audio as Float32Array
      self.postMessage({ type: 'audio', id: m.id, audio, rate: out.sampling_rate }, [audio.buffer])
    }
  } catch (err) {
    tts = null
    self.postMessage({ type: 'error', id: m.id, error: String(err) })
  }
}
