import type { PalId } from './core'
export const SPEECH_STYLE: Record<PalId, { rate: number; pitch: number }> = { rei: { rate: 1.1, pitch: 1 }, diel: { rate: .9, pitch: .95 }, jhyvie: { rate: 1, pitch: 1 }, jaypee: { rate: 1.05, pitch: 1.05 } }
export function cleanSpeech(raw: string): string {
  return raw.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#_~`>]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim()
}
export function maleVoice(v: { name: string; voiceURI?: string; localService: boolean; lang: string }, pal: PalId, text: string, englishRequested = false) {
  const name = `${v.name} ${v.voiceURI ?? ''}`
  const male = /\bmale\b|\b(andrew|brian|guy|angelo|james|daniel|alex|fred|david|ryan|george|thomas|aaron|arthur|oliver|christopher|eric)\b/i.test(name) && !/female|samantha|victoria|blessica|jenny|emma|ava/i.test(name)
  const filipino = /^(fil|tl)(-|$)/i.test(v.lang)
  return v.localService && male && (pal === 'jhyvie' && !englishRequested ? filipino : /^en(-|$)/i.test(v.lang))
}
