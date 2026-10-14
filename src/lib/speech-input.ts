import type { PalId } from './core'

export function recognitionLanguage(pal: PalId, browserLanguage = 'en-US') {
  return pal === 'jhyvie' ? 'fil-PH' : browserLanguage.startsWith('en') ? browserLanguage : 'en-US'
}

/** Results contain the whole session; interim hypotheses can be replaced between events. */
export function readRecognitionResults(results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>) {
  const final: string[] = []
  const all: string[] = []
  for (let i = 0; i < results.length; i++) {
    const text = results[i][0]?.transcript.trim()
    if (!text) continue
    all.push(text)
    if (results[i].isFinal) final.push(text)
  }
  return { final: final.join(' '), text: all.join(' ') }
}
