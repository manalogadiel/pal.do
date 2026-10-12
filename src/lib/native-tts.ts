// Android's WebView has no speechSynthesis, so in the app Pal talks through the phone's own text-to-speech
// (offline, free, the voices the user already has installed). On the web this is never used.
import { Capacitor } from '@capacitor/core'
import { TextToSpeech } from '@capacitor-community/text-to-speech'
import type { PalId } from './core'

export const hasNativeTts = () => Capacitor.isNativePlatform()

/** Same feel as the browser voices: Rei calm, Diel even, Jaypee quick, Jhyvie bright (and Filipino when installed) */
const STYLE: Record<PalId, { pitch: number; rate: number }> = {
  rei: { pitch: 1.05, rate: 0.95 },
  diel: { pitch: 0.92, rate: 1.0 },
  jaypee: { pitch: 1.0, rate: 1.1 },
  jhyvie: { pitch: 1.2, rate: 1.03 },
}

let filipino: Promise<string> | null = null
/** Jhyvie speaks Taglish: a Filipino voice reads it best, if the phone has one; otherwise Philippine or US English */
function jhyvieLang(): Promise<string> {
  return (filipino ??= (async () => {
    for (const lang of ['fil-PH', 'en-PH']) {
      try {
        if ((await TextToSpeech.isLanguageSupported({ lang })).supported) return lang
      } catch {}
    }
    return 'en-US'
  })())
}

/** Resolves when Pal has finished (or was stopped) */
export async function speakNative(text: string, pal: PalId): Promise<void> {
  const lang = pal === 'jhyvie' ? await jhyvieLang() : 'en-US'
  try {
    await TextToSpeech.speak({ text, lang, ...STYLE[pal], volume: 1, category: 'playback', queueStrategy: 0 })
  } catch {
    // stopped mid-line, or no TTS engine installed: either way Pal is done talking
  }
}

export function stopNative() {
  if (hasNativeTts()) TextToSpeech.stop().catch(() => {})
}

/**
 * Reading a reviewer out loud, one sentence-sized piece at a time (browsers cut off long utterances).
 * Resolves when the piece is done or stopped. The phone's voice in the app, the browser's on the web.
 */
export function readPiece(text: string, pal: PalId): Promise<void> {
  if (hasNativeTts()) return speakNative(text, pal)
  if (!('speechSynthesis' in window)) return Promise.resolve()
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = pal === 'jhyvie' ? 'en-PH' : 'en-US'
    u.rate = STYLE[pal].rate * 0.95
    u.pitch = STYLE[pal].pitch
    u.onend = () => done()
    u.onerror = () => done()
    speechSynthesis.speak(u)
  })
}
export function stopReading() {
  stopNative()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

/** "Mitosis. Cell division that…" in pieces of a sentence or two (≤ 220 chars) */
export function readingPieces(text: string): string[] {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g) ?? []
  const out: string[] = []
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && (out.at(-1)!.length + s.length) < 220) out[out.length - 1] += ` ${s}`
    else out.push(s.length > 300 ? s.slice(0, 300) : s)
  }
  return out
}
