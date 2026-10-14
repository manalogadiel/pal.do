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
    const index = voices.findIndex(v => maleVoice(v, pal, text, englishRequested))
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
  const voice = window.speechSynthesis.getVoices().find(v => maleVoice(v, pal, text, englishRequested))
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
export async function speakPal(raw: string, pal: PalId, onStart?: () => void, englishRequested = false): Promise<boolean | 'cancelled'> {
  stopSpeech()
  const id = generation, abort = new AbortController(); controller = abort
  const text = cleanSpeech(raw, pal, englishRequested).slice(0, 2000)
  if (!text) return false
  const url = import.meta.env.VITE_TTS_URL || '/tts'
  const timer = setTimeout(() => abort.abort(), 10_000)
  try {
    if (navigator.onLine) {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pal, text }), signal: abort.signal })
      if (!r.ok || !r.headers.get('content-type')?.includes('audio/mpeg')) throw new Error('Speech unavailable')
      const blob = await r.blob(); clearTimeout(timer)
      if (id !== generation) return 'cancelled'
      if (abort.signal.aborted) throw new Error('Speech timed out')
      const source = URL.createObjectURL(blob), audio = new Audio(source); playback = audio
      try { const played = await new Promise<boolean>((resolve, reject) => {
        let settled = false
        const end = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(safety); abort.signal.removeEventListener('abort', cancel); if (release === cancel) release = null; resolve(ok) }
        const cancel = () => end(false); release = cancel
        const safety = setTimeout(() => { audio.pause(); end(false) }, 180_000)
        audio.onended = () => end(true); audio.onerror = () => { end(false) }; audio.onplaying = () => onStart?.()
        abort.signal.addEventListener('abort', cancel, { once: true }); audio.play().catch(() => end(false))
      }); if (played) return true; throw new Error('Playback unavailable') } finally { audio.pause(); URL.revokeObjectURL(source); if (playback === audio) playback = null; release = null }
    }
  } catch {} finally { clearTimeout(timer) }
  if (id !== generation) return 'cancelled'
  // Timeout aborts only the network attempt. A fresh signal permits a local fallback.
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
