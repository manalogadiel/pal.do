import type { PalId } from './core'

/** Each pal's Kokoro voice. All four ship in /public/kokoro/voices. */
export const PAL_VOICE: Record<PalId, { voice: string; speed: number }> = {
  rei: { voice: 'af_heart', speed: 0.95 },
  diel: { voice: 'am_michael', speed: 1 },
  jhyvie: { voice: 'af_bella', speed: 1.05 },
  jaypee: { voice: 'am_puck', speed: 1.1 },
}

type Status = 'idle' | 'loading' | 'ready' | 'failed'
let status: Status = 'idle'
let worker: Worker | null = null
let ctx: AudioContext | null = null
let current: AudioBufferSourceNode | null = null
let seq = 0
const waiting = new Map<number, { onStart: () => void; onEnd: () => void }>()
const listeners = new Set<(s: Status) => void>()
const set = (s: Status) => { status = s; listeners.forEach((f) => f(s)) }

export const kokoroStatus = () => status
export function onKokoroStatus(f: (s: Status) => void) {
  listeners.add(f)
  return () => { listeners.delete(f) }
}

/** Start loading the offline model in a worker (idempotent). */
export function loadKokoro() {
  if (worker || status === 'failed') return
  set('loading')
  try {
    worker = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return set('failed')
  }
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'ready') set('ready')
    else if (m.type === 'error') {
      console.warn('[kokoro]', m.error)
      const w = waiting.get(m.id)
      waiting.delete(m.id)
      w?.onEnd()
      if (status !== 'ready') set('failed')
    } else if (m.type === 'audio') {
      const w = waiting.get(m.id)
      waiting.delete(m.id)
      if (!w || m.id !== seq) return // superseded by a newer line
      play(m.audio, m.rate, w)
    }
  }
  worker.onerror = (e) => { console.warn('[kokoro]', e.message); set('failed') }
  worker.postMessage({ type: 'load' })
}

function play(audio: Float32Array, rate: number, w: { onStart: () => void; onEnd: () => void }) {
  ctx ??= new AudioContext()
  ctx.resume()
  const buf = ctx.createBuffer(1, audio.length, rate)
  buf.copyToChannel(audio as Float32Array<ArrayBuffer>, 0)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.onended = () => { if (current === src) current = null; w.onEnd() }
  stopKokoro()
  current = src
  src.start()
  w.onStart()
}

export function stopKokoro() {
  try { current?.stop() } catch {}
  current = null
}

/** Speak with the pal's voice. Returns false if the model isn't ready (caller falls back). */
export function speakKokoro(text: string, pal: PalId, onStart: () => void, onEnd: () => void) {
  if (status !== 'ready' || !worker) {
    loadKokoro()
    return false
  }
  ctx ??= new AudioContext()
  ctx.resume() // inside the user's gesture where possible
  stopKokoro()
  const id = ++seq
  waiting.clear()
  waiting.set(id, { onStart, onEnd })
  const v = PAL_VOICE[pal]
  worker.postMessage({ type: 'speak', id, text, voice: v.voice, speed: v.speed })
  return true
}
