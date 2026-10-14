import type { PalId } from './core'
export const SPEECH_STYLE: Record<PalId, { rate: number; pitch: number }> = { rei: { rate: 1, pitch: 1 }, diel: { rate: 1, pitch: 1 }, jhyvie: { rate: 1, pitch: 1 }, jaypee: { rate: 1, pitch: 1 } }

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
function spokenNumber(n: number): string {
  if (n < 20) return SMALL_NUMBERS[n]
  if (n < 100) return ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10)] + (n % 10 ? ` ${SMALL_NUMBERS[n % 10]}` : '')
  if (n < 1000) return `${SMALL_NUMBERS[Math.floor(n / 100)]} hundred${n % 100 ? ` ${spokenNumber(n % 100)}` : ''}`
  if (n < 1_000_000) return `${spokenNumber(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${spokenNumber(n % 1000)}` : ''}`
  return String(n)
}

const CLOCK = String.raw`(?:(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*[ap](?:\.m\.?|m\b)|(?:[01]?\d|2[0-3]):[0-5]\d\b)`
function spokenDuration(amount: string, unit: 'hour' | 'minute') {
  const [whole, fraction] = amount.split('.')
  const number = spokenNumber(Number(whole)) + (fraction ? ` point ${[...fraction].map(d => SMALL_NUMBERS[Number(d)]).join(' ')}` : '')
  return `${number} ${unit}${Number(amount) === 1 ? '' : 's'}`
}
function durationSpeech(text: string) {
  // Adjacent hour/minute units need separating before the individual unit pass.
  const separated = text.replace(/\b(\d+(?:\.\d+)?)h(?=\d+m\b)/gi, '$1h ')
  return separated.replace(/\b(\d+(?:\.\d+)?)(\s*)(hours?|hrs?|h|minutes?|mins?|m)\b(?![²³/])/gi, (match, amount, space, unit, offset: number) => {
    if (unit.toLowerCase() === 'm') {
      const before = separated.slice(0, offset).split(/[.!?;\n]/).pop()!.slice(-60)
      const after = separated.slice(offset + match.length, offset + match.length + 45)
      // A bare m can also denote meters. Keep measurements and unrelated spaced units intact.
      const measurement = /\b(?:walk|run|swim|distance|length|height|width|meters?|metres?|sukat|haba|taas|lakad|takbo)\s*(?:of\s*)?$/i.test(before)
        || /^\s*(?:\/|(?:of\s+)?(?:cable|rope|wire|fabric|tall|long|wide|deep|meters?|metres?)\b)/i.test(after)
        || /^\s*(?:by|[×x])\s*\d/i.test(after) || /\d\s*m\s*(?:by|[×x])\s*$/i.test(before)
      const timeContext = /\b(?:in|for|wait|takes?|focus|break|timer|session|study|duration|remaining|booked|free|available|minutes?|hours?|biyahe|hintay|pahinga|natitira|tagal|oras)\b/i.test(before)
      if (measurement || (space && !timeContext)) return match
    }
    return spokenDuration(amount, /^h/i.test(unit) ? 'hour' : 'minute')
  })
}
export function cleanSpeech(raw: string, pal?: PalId, englishRequested = false): string {
  if(pal==='rei')raw=raw.replace(/\b(hi|hello|hey)[, ]+pol\b/gi,'$1, Paul')
  const taglish = pal === 'jhyvie' && !englishRequested
  const spokenPeriod = (morning: boolean) => (!pal || pal === 'jhyvie') && !englishRequested ? (morning ? 'ey em' : 'pee em') : (morning ? 'A. M.' : 'P. M.')
  const ranges = raw.replace(new RegExp(String.raw`\b(${CLOCK})\s*[–—-]\s*(${CLOCK})`, 'gi'), (_, start, end) => `${start} ${taglish ? 'hanggang' : 'to'} ${end}`)
  const clocks = ranges.replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])(?:\.m\.?|m\b)/gi, (_, hour, minute, period) => {
    const m = Number(minute ?? 0)
    if (Number(hour) === 12 && m === 0) {
      const noon = period.toLowerCase() === 'p'
      return taglish ? `twelve ng ${noon ? 'tanghali' : 'madaling araw'}` : `twelve ${noon ? 'noon' : 'midnight'}`
    }
    return `${spokenNumber(Number(hour))}${m ? ` ${m < 10 ? 'oh ' : ''}${spokenNumber(m)}` : ''} ${spokenPeriod(period.toLowerCase() === 'a')}`
  }).replace(/(?<![\w:])([01]?\d|2[0-3]):([0-5]\d)(?![\w:])/g, (_, hour, minute) => {
    const h = Number(hour), m = Number(minute)
    if (!h && !m) return 'midnight'
    const spoken = `${spokenNumber(h > 12 ? h - 12 : h || 12)}${m ? ` ${m < 10 ? 'oh ' : ''}${spokenNumber(m)}` : ''}`
    if (h > 12 || !h) return `${spoken} ${spokenPeriod(!h)}`
    return `${spoken}${m ? '' : " o'clock"}`
  })
  return durationSpeech(clocks).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#_~`>]/g, '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim()
}
export function maleVoice(v: { name: string; voiceURI?: string; localService: boolean; lang: string }, pal: PalId, text: string, englishRequested = false) {
  const name = `${v.name} ${v.voiceURI ?? ''}`
  const male = /\bmale\b|\b(andrew|brian|guy|angelo|james|daniel|alex|fred|david|ryan|george|thomas|aaron|arthur|oliver|christopher|eric)\b/i.test(name) && !/female|samantha|victoria|blessica|jenny|emma|ava/i.test(name)
  const filipino = /^(fil|tl)(-|$)/i.test(v.lang)
  return v.localService && male && (pal === 'jhyvie' && !englishRequested ? filipino : /^en(-|$)/i.test(v.lang))
}
