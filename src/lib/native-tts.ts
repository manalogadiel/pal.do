import { Capacitor } from '@capacitor/core'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import type { PalId } from './core'
import { cleanSpeech, maleVoice, SPEECH_STYLE } from './speech-profile'
export const hasNativeTts = () => Capacitor.isNativePlatform()
let controller: AbortController | null = null
let playback: HTMLAudioElement | null = null
let release: (() => void) | null = null
let generation = 0
export function stopSpeech() {
  generation++; controller?.abort(); controller = null
  if (playback) { playback.pause(); playback.src = ''; playback = null }
  release?.(); release = null
  if (hasNativeTts()) void TextToSpeech.stop().catch(() => {})
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}
async function localSpeak(text: string, pal: PalId, signal: AbortSignal, englishRequested: boolean): Promise<boolean> {
  if (signal.aborted) return false
  if (hasNativeTts()) {
    let queryTimer: ReturnType<typeof setTimeout>
    let queryAbort: () => void = () => {}
    const cancellation = new Promise<never>((_, reject) => { queryTimer = setTimeout(() => reject(new Error('Voice discovery timed out')), 10_000); queryAbort = () => reject(new Error('Speech cancelled')); signal.addEventListener('abort', queryAbort, { once: true }) })
    const { voices } = await Promise.race([TextToSpeech.getSupportedVoices(), cancellation]).finally(() => { clearTimeout(queryTimer); signal.removeEventListener('abort', queryAbort) })
    let index = voices.findIndex(v => maleVoice(v, pal, text, englishRequested))
    if (index < 0) index = voices.findIndex(v => maleVoice(v, pal, text, true))
    if (index < 0) index = voices.findIndex(v => /^en(-|$)/i.test(v.lang))
    if (index < 0 && voices.length) index = 0
    if (index < 0 || signal.aborted) return false
    return new Promise<boolean>(resolve => {
      let settled = false
      const end = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timeout); signal.removeEventListener('abort', cancel); resolve(ok) }
      const cancel = () => { void TextToSpeech.stop().catch(() => {}); end(false) }
      const timeout = setTimeout(cancel, Math.min(120_000, 5000 + text.length * 110))
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) { cancel(); return }
      void TextToSpeech.speak({ text, lang: voices[index].lang, voice: index, ...SPEECH_STYLE[pal], volume: 1, category: 'playback', queueStrategy: 0 }).then(() => end(true), () => end(false))
    })
  }
  if (!('speechSynthesis' in window)) return false
  const list = window.speechSynthesis.getVoices()
  const voice = list.find(v => maleVoice(v, pal, text, englishRequested)) ?? list.find(v => maleVoice(v, pal, text, true)) ?? list.find(v => /^en(-|$)/i.test(v.lang)) ?? list[0]
  if (!voice) return false
  return new Promise<boolean>(resolve => {
    const u = new SpeechSynthesisUtterance(text)
    u.voice = voice; u.lang = voice.lang; Object.assign(u, SPEECH_STYLE[pal])
    let done = false
    const end = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(ok) }
    const abort = () => end(false)
    const timer = setTimeout(() => { window.speechSynthesis.cancel(); end(false) }, Math.min(120_000, 5000 + text.length * 110))
    u.onend = () => end(true); u.onerror = () => end(false); signal.addEventListener('abort', abort, { once: true })
    window.speechSynthesis.speak(u)
  })
}
/** One speech operation; cancellation resolves the prior operation and prevents stale fallback/audio. */
/**
 * Edge audio plays through an AudioContext started on their first tap. A new Audio() may be refused later without a
 * tap (a hands-free reply), and Pal then switched to the device's voice mid-conversation.
 */
let audioCtx: AudioContext | null = null
if (typeof window !== 'undefined' && 'AudioContext' in window) {
  const unlock = () => {
    try { audioCtx ??= new AudioContext() } catch { return }
    void audioCtx.resume().then(() => {
      if (audioCtx?.state !== 'running') return
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }).catch(() => {})
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

/** One Edge reply: true once it finished playing, false if stopped or it couldn't play */
async function playEdge(blob: Blob, signal: AbortSignal, onStart?: () => void): Promise<boolean> {
  if (audioCtx?.state === 'suspended') await audioCtx.resume().catch(() => {})
  if (audioCtx?.state === 'running') {
    const ctx = audioCtx
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (signal.aborted) return false
    return new Promise<boolean>((resolve) => {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      let settled = false
      const end = (ok: boolean) => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (release === cancel) release = null; resolve(ok) }
      const cancel = () => { try { src.stop() } catch {} end(false) }
      release = cancel
      src.onended = () => end(true)
      signal.addEventListener('abort', cancel, { once: true })
      src.start()
      onStart?.()
    })
  }
  // No tap yet this visit: the plain audio element (the browser may still allow it)
  const source = URL.createObjectURL(blob), audio = new Audio(source); playback = audio
  try {
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const end = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(safety); signal.removeEventListener('abort', cancel); if (release === cancel) release = null; resolve(ok) }
      const cancel = () => end(false); release = cancel
      const safety = setTimeout(() => { audio.pause(); end(false) }, 180_000)
      audio.onended = () => end(true); audio.onerror = () => { end(false) }; audio.onplaying = () => onStart?.()
      signal.addEventListener('abort', cancel, { once: true }); audio.play().catch(() => end(false))
    })
  } finally { audio.pause(); URL.revokeObjectURL(source); if (playback === audio) playback = null; release = null }
}

/** Pal's Edge voice for this text (one more try if Microsoft or the network hiccups); null when it can't be had */
async function fetchEdge(url: string, pal: PalId, text: string, signal: AbortSignal): Promise<Blob | null> {
  for (let tries = 0; tries < 2 && !signal.aborted; tries++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pal, text }), signal })
      if (r.ok && r.headers.get('content-type')?.includes('audio/mpeg')) return await r.blob()
      if (r.status === 400 || r.status === 403) return null // the request itself is wrong: trying again won't help
    } catch {}
  }
  return null
}

/** One speech operation; cancellation resolves the prior operation and prevents stale fallback/audio. */
export async function speakPal(raw: string, pal: PalId, onStart?: () => void, englishRequested = false): Promise<boolean | 'cancelled'> {
  stopSpeech()
  const id = generation, abort = new AbortController(); controller = abort
  const text = cleanSpeech(raw, pal, englishRequested).slice(0, 2000)
  if (!text) return false
  const url = import.meta.env.VITE_TTS_URL || '/tts'
  // The website (and dev server) always has the Edge voice at /tts; the Android app only when a host is set
  const edge = !hasNativeTts() || !!import.meta.env.VITE_TTS_URL
  if (edge && navigator.onLine) {
    const timer = setTimeout(() => abort.abort(), 15_000)
    const blob = await fetchEdge(url, pal, text, abort.signal).finally(() => clearTimeout(timer))
    if (id !== generation) return 'cancelled'
    // Online, Pal keeps one voice: if Edge can't speak this reply, it stays on screen ("Voice unavailable")
    // rather than switching to the device's voice for it
    if (!blob) return false
    try { return (await playEdge(blob, abort.signal, onStart)) || (id !== generation ? 'cancelled' : false) } catch { return id === generation ? false : 'cancelled' }
  }
  // Offline (or no Edge voice in the Android app): the device's own voice
  const local = new AbortController(); controller = local
  onStart?.()
  try { const ok = await localSpeak(text, pal, local.signal, englishRequested); return id === generation ? ok : 'cancelled' } catch { return id === generation ? false : 'cancelled' }
}
export const speakNative = speakPal
export const stopNative = stopSpeech
export async function readPiece(text: string, pal: PalId) { const result = await speakPal(text, pal); if (result !== true) throw new Error(result === 'cancelled' ? 'Reading stopped.' : 'Voice unavailable. You can still read the material here.') }
export const stopReading = stopSpeech
export function readingPieces(text: string): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' '), out: string[] = []
  for (const word of words) { if (out.length && out[out.length - 1].length + word.length < 220) out[out.length - 1] += ` ${word}`; else out.push(word) }
  return out.filter(Boolean)
}
