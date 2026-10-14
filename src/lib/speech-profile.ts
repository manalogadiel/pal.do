import type { PalId } from './core'
export const SPEECH_STYLE: Record<PalId, { rate: number; pitch: number }> = { rei: { rate: 1, pitch: 1 }, diel: { rate: 1, pitch: 1 }, jhyvie: { rate: 1, pitch: 1 }, jaypee: { rate: 1, pitch: 1 } }

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
function spokenNumber(n: number) {
  return n < 20 ? SMALL_NUMBERS[n] : ['', '', 'twenty', 'thirty', 'forty', 'fifty'][Math.floor(n / 10)] + (n % 10 ? ` ${SMALL_NUMBERS[n % 10]}` : '')
}

const CLOCK = String.raw`(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap](?:\.m\.?|m\b)`
export function cleanSpeech(raw: string, pal?: PalId, englishRequested = false): string {
  if(pal==='rei')raw=raw.replace(/\b(hi|hello|hey)[, ]+pol\b/gi,'$1, Paul')
  const taglish = pal === 'jhyvie' && !englishRequested
  const ranges = raw.replace(new RegExp(String.raw`\b(${CLOCK})\s*[–—-]\s*(${CLOCK})`, 'gi'), (_, start, end) => `${start} ${taglish ? 'hanggang' : 'to'} ${end}`)
  return ranges.replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])(?:\.m\.?|m\b)/gi, (_, hour, minute, period) => {
    const m = Number(minute ?? 0)
    if (Number(hour) === 12 && m === 0) {
      const noon = period.toLowerCase() === 'p'
      return taglish ? `twelve ng ${noon ? 'tanghali' : 'madaling araw'}` : `twelve ${noon ? 'noon' : 'midnight'}`
    }
    return `${spokenNumber(Number(hour))}${m ? ` ${m < 10 ? 'oh ' : ''}${spokenNumber(m)}` : ''} ${(!pal||pal==='jhyvie')&&!englishRequested?(period.toLowerCase()==='a'?'ey em':'pee em'):(period.toLowerCase()==='a'?'A. M.':'P. M.')}`
  }).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#_~`>]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim()
}
export function maleVoice(v: { name: string; voiceURI?: string; localService: boolean; lang: string }, pal: PalId, text: string, englishRequested = false) {
  const name = `${v.name} ${v.voiceURI ?? ''}`
  const male = /\bmale\b|\b(andrew|brian|guy|angelo|james|daniel|alex|fred|david|ryan|george|thomas|aaron|arthur|oliver|christopher|eric)\b/i.test(name) && !/female|samantha|victoria|blessica|jenny|emma|ava/i.test(name)
  const filipino = /^(fil|tl)(-|$)/i.test(v.lang)
  return v.localService && male && (pal === 'jhyvie' && !englishRequested ? filipino : /^en(-|$)/i.test(v.lang))
}
