// What Pal does with a reviewer, without any AI: split it into passages, find the passages about a topic (BM25
// keyword search, on the device), pull out term–definition flashcards, build a multiple-choice quiz from them, and
// guess how long it takes to study. The cloud model can write better cards and questions, but only from these
// passages, and everything here still works offline or when the free quota runs out.

export interface Chunk { id: string; page: number; heading?: string; text: string }
export interface Card { id: string; front: string; back: string; page?: number }
export interface QuizItem { id: string; question: string; choices: string[]; answer: number; page?: number }

const WORDS_PER_CHUNK = 400

/** A line that reads like a heading: short, no full stop, Title Case or ALL CAPS, or "Chapter 3" / "Lesson 2" / "1.2 …" */
function isHeading(line: string) {
  const t = line.trim()
  if (!t || t.length > 70 || /[.?!,;]$/.test(t) || t.split(/\s+/).length > 9) return false
  if (/^(chapter|lesson|module|unit|topic|part|section)\b/i.test(t) || /^\d+(\.\d+)*\s+\p{L}/u.test(t)) return true
  const letters = t.replace(/[^\p{L}]/gu, '')
  return letters.length >= 3 && (letters === letters.toUpperCase() || t.split(/\s+/).every((w) => /^[\p{Lu}\d(]/u.test(w) || /^(of|and|the|in|on|a|an|to|for|ng|sa|at)$/i.test(w)))
}

/** Pages of text → passages of about 400 words, each with its page and the heading above it */
export function chunkPages(pages: string[]): Chunk[] {
  const out: Chunk[] = []
  pages.forEach((page, p) => {
    let heading: string | undefined = out.at(-1)?.heading
    let buf: string[] = []
    let words = 0
    const flush = () => {
      const text = buf.join('\n').trim()
      if (text.split(/\s+/).length >= 8) out.push({ id: `c${out.length + 1}`, page: p + 1, heading, text })
      buf = []
      words = 0
    }
    for (const line of page.split('\n')) {
      if (isHeading(line) && words > 40) { flush(); heading = line.trim() }
      else if (isHeading(line) && !words) heading = line.trim()
      buf.push(line)
      words += line.split(/\s+/).filter(Boolean).length
      if (words >= WORDS_PER_CHUNK) flush()
    }
    flush()
  })
  return out
}

/* ---------- Search: BM25 over the passages, so "quiz me on mitosis" uses the right pages ---------- */
const STOP = new Set('the a an and or of to in on for is are was were be by with as at it this that from into ng sa ang mga na at ay si ni ko mo ka me my about quiz flashcards cards make review chapter lesson'.split(' '))
export const terms = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w))

export function search(chunks: Chunk[], query: string, k = 4): Chunk[] {
  const q = [...new Set(terms(query))]
  if (!q.length || !chunks.length) return chunks.slice(0, k)
  const docs = chunks.map((c) => terms(`${c.heading ?? ''} ${c.heading ?? ''} ${c.text}`))
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]))
  const scored = docs.map((d, i) => {
    let score = 0
    for (const t of q) {
      const tf = d.filter((w) => w === t).length
      if (!tf) continue
      const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))))
    }
    return { c: chunks[i], score }
  })
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.c)
  return hits.length ? hits.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) : chunks.slice(0, k)
}

/* ---------- Flashcards the app can find by itself ---------- */
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s•\-–*\d.)]+/, '').trim()

/**
 * "Mitosis – cell division that…", "Osmosis: the movement of…", "Photosynthesis is the process…",
 * "Ang mitosis ay …": a short term and a real definition become a card. Headings and fragments don't.
 */
export function extractCards(chunks: Chunk[], max = 60): Card[] {
  const out: Card[] = []
  const seen = new Set<string>()
  const add = (front: string, back: string, page: number) => {
    front = clean(front).replace(/[:–—-]+$/, '').trim()
    back = clean(back).replace(/^(is|are|refers to|means|ay)\s+/i, '')
    const key = front.toLowerCase()
    const words = front.split(/\s+/).length
    if (words > 6 || front.length < 2 || back.split(/\s+/).length < 4 || back.length > 300 || seen.has(key)) return
    if (/^(the|this|that|it|they|these|those|there|here|note|example|answer|question)$/i.test(front)) return
    seen.add(key)
    out.push({ id: `k${out.length + 1}`, front, back: back.replace(/^\p{Ll}/u, (c) => c.toUpperCase()), page })
  }
  for (const c of chunks) {
    for (const raw of c.text.split('\n')) {
      if (out.length >= max) return out
      const line = raw.trim()
      const colon = line.match(/^([^:–—]{2,60}?)\s*(?::|\s[–—-]\s)\s*(.{12,})$/)
      if (colon && !/^https?$/i.test(colon[1])) { add(colon[1], colon[2], c.page); continue }
      const is = line.match(/^(?:(?:ang|an?|the)\s+)?(\p{Lu}[\p{L}\p{N}'’ -]{1,50}?)\s+(is|are|refers to|means|is called|ay)\s+(.{12,})$/u)
      if (is) add(is[1], is[3], c.page)
    }
  }
  return out
}

/* ---------- A quiz from cards: the right definition among three others from the same reviewer ---------- */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}
export function quizFromCards(cards: Card[], n = 10, seed = Date.now()): QuizItem[] {
  if (cards.length < 4) return []
  const r = rng(seed)
  const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }
  return shuffle(cards).slice(0, n).map((card, i) => {
    // Every other question asks the other way round: definition → term
    const askTerm = i % 2 === 1
    const others = shuffle(cards.filter((c) => c.id !== card.id)).slice(0, 3)
    const right = askTerm ? card.front : card.back
    const choices = shuffle([right, ...others.map((o) => (askTerm ? o.front : o.back))])
    return { id: `q${i + 1}`, question: askTerm ? `Which term matches: “${card.back}”` : `What is ${card.front}?`, choices, answer: choices.indexOf(right), page: card.page }
  })
}

/** Reading it twice at a student pace (about 150 words a minute), rounded to half hours, 1–12 h */
export function studyHours(pages: string[]): number {
  const words = pages.join(' ').split(/\s+/).filter(Boolean).length
  return Math.min(12, Math.max(1, Math.round(((words / 150) * 2) / 60 * 2) / 2))
}

/** The topics a plan covers, from the reviewer's own headings */
export function topicsOf(chunks: Chunk[], max = 8): string[] {
  return [...new Set(chunks.map((c) => c.heading).filter((h): h is string => !!h))].slice(0, max)
}

/** "BIO101_Midterm-Reviewer (2).pdf" → "BIO101 Midterm Reviewer" */
export function titleFromFileName(name: string) {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/\(\d+\)$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Reviewer'
}

/**
 * The folder a new file belongs in: one whose name shares a word with the file name ("Bio" ↔ "BIO101 reviewer"),
 * or else a new folder named after an upcoming exam the file mentions, or the file's own subject.
 */
export function suggestFolder(fileName: string, folders: { id: string; name: string }[], exams: string[]): { id?: string; name: string } {
  const words = new Set(terms(titleFromFileName(fileName)).flatMap((w) => [w, w.replace(/\d+$/, '')]).filter((w) => w.length > 2 && !/^(reviewer|notes?|midterms?|finals?|prelims?|exam|module|handout|pdf|copy|final)$/.test(w)))
  const hit = folders.find((f) => terms(f.name).some((w) => words.has(w) || words.has(w.replace(/\d+$/, ''))))
  if (hit) return { id: hit.id, name: hit.name }
  const exam = exams.find((e) => terms(e).some((w) => words.has(w)))
  if (exam) return { name: exam.replace(/\b(exam|quiz|prelims?|midterms?|finals?|long test)\b/gi, '').replace(/\s+/g, ' ').trim() || exam }
  const first = titleFromFileName(fileName).split(' ').filter((w) => !/^(reviewer|notes?|midterms?|finals?|prelims?|exam|module|handout)$/i.test(w))
  return { name: first.slice(0, 2).join(' ') || 'My reviewers' }
}
