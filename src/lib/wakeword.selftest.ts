// Dev-only check of the wake-word engine on recorded clips, no microphone: await window.__palWakeTest({ pal, urls })
// Each WAV (16 kHz mono 16-bit) goes through the engine in 32 ms frames like the mic's, and comes back with every
// score and when it fired, so the browser's numbers can be compared with the Python training pipeline.
import { ort } from '@ricky0123/vad-web/dist/real-time-vad'
import type { PalId } from './core'
import { vadOrtConfig } from './handsfree'
import { WakeEngine } from './wakeword'

async function readWav(url: string) {
  const buf = await (await fetch(url)).arrayBuffer()
  const v = new DataView(buf)
  let at = 12
  while (at < v.byteLength - 8) {
    const id = String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))
    const size = v.getUint32(at + 4, true)
    if (id === 'data') {
      const out = new Float32Array(size / 2)
      for (let i = 0; i < out.length; i++) out[i] = v.getInt16(at + 8 + i * 2, true) / 32767
      return out
    }
    at += 8 + size
  }
  throw new Error(`${url}: no audio`)
}

export async function runWakeTest({ pal, urls }: { pal: PalId; urls: string[] }) {
  const paths = await vadOrtConfig()
  ort.env.wasm.wasmPaths = paths
  ort.env.wasm.numThreads = 1
  const results = []
  for (const url of urls) {
    const fired: number[] = []
    let step = 0
    const engine = await WakeEngine.load(ort, pal, () => fired.push(step))
    const scores: number[] = []
    engine.onScore = (s) => scores.push(s)
    const audio = await readWav(url)
    const t0 = performance.now()
    for (let i = 0; i + 512 <= audio.length; i += 512) {
      engine.push(audio.subarray(i, i + 512))
      await engine.idle()
      step = Math.floor((i + 512) / 1280)
    }
    const ms = performance.now() - t0
    results.push({ url, threshold: engine.threshold, fired, scores, msPerStep: ms / Math.max(1, Math.floor(audio.length / 1280)), seconds: audio.length / 16000 })
    engine.dispose()
  }
  return results
}

