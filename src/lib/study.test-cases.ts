// Study library logic: passages, search, flashcards, quizzes, hours, folder suggestions. No browser, no AI.
import { newFolder, type Folder } from './library'
import { chunkPages, extractCards, quizFromCards, search, studyHours, suggestFolder, titleFromFileName, topicsOf } from './study-material'

const BIO = [
  `CELL DIVISION
Mitosis – the division of one cell into two identical daughter cells.
Meiosis: cell division that makes four sex cells with half the chromosomes.
Cytokinesis is the splitting of the cytoplasm after the nucleus divides.
The cell spends most of its life in interphase, growing and copying its DNA before it divides again.`,
  `TRANSPORT ACROSS MEMBRANES
Osmosis is the movement of water across a membrane from low to high solute concentration.
Diffusion – the spreading of particles from high to low concentration without energy.
Active transport: moving particles against the gradient using energy from ATP.
This: is not a card because it is a pronoun line.`,
]

export function runStudyTests(): string[] {
  const fails: string[] = []
  const t = (name: string, ok: () => boolean) => { try { if (!ok()) fails.push(name) } catch (e) { fails.push(`${name}: ${String(e)}`) } }
  const chunks = chunkPages(BIO)

  t('passages keep their page and the heading above them', () => chunks.length === 2 && chunks[0].page === 1 && chunks[0].heading === 'CELL DIVISION' && chunks[1].heading === 'TRANSPORT ACROSS MEMBRANES')
  t('search finds the page a topic is on', () => search(chunks, 'quiz me on osmosis')[0]?.page === 2 && search(chunks, 'mitosis', 1)[0]?.page === 1)
  t('search with nothing matching still returns passages', () => search(chunks, 'quantum chromodynamics').length > 0)
  const cards = extractCards(chunks)
  t('term–definition lines become flashcards', () => ['Mitosis', 'Meiosis', 'Cytokinesis', 'Osmosis', 'Diffusion', 'Active transport'].every((f) => cards.some((c) => c.front === f)))
  t('pronouns and headings are never a card', () => !cards.some((c) => /^(this|cell division)$/i.test(c.front)))
  t('a card keeps its page', () => cards.find((c) => c.front === 'Osmosis')?.page === 2)
  t('definitions start with a capital and drop "is"', () => cards.find((c) => c.front === 'Osmosis')!.back.startsWith('The movement of water'))
  const quiz = quizFromCards(cards, 5, 42)
  t('a quiz has 4 choices with exactly the right answer in them', () => quiz.length === 5 && quiz.every((q) => q.choices.length === 4 && new Set(q.choices).size === 4 && q.answer >= 0 && q.answer < 4))
  t('quiz answers are true to the reviewer', () => quiz.every((q) => {
    const c = cards.find((card) => q.question === `What is ${card.front}?` || q.question.includes(card.back))!
    return q.choices[q.answer] === (q.question.startsWith('What is') ? c.back : c.front)
  }))
  t('the same seed gives the same quiz', () => JSON.stringify(quizFromCards(cards, 5, 7)) === JSON.stringify(quizFromCards(cards, 5, 7)))
  t('fewer than 4 cards is no quiz', () => quizFromCards(cards.slice(0, 3)).length === 0)
  t('study time comes from the length, 1–12 hours', () => studyHours(BIO) === 1 && studyHours([Array(9000).fill('word').join(' ')]) === 2 && studyHours([Array(200000).fill('w').join(' ')]) === 12)
  t('topics come from headings', () => topicsOf(chunks).join('|') === 'CELL DIVISION|TRANSPORT ACROSS MEMBRANES')
  t('file names become readable titles', () => titleFromFileName('BIO101_Midterm-Reviewer (2).pdf') === 'BIO101 Midterm Reviewer')
  t('a file goes to the folder of its subject', () => suggestFolder('BIO101_Midterm-Reviewer.pdf', [{ id: 'f1', name: 'Math' }, { id: 'f2', name: 'Bio' }], []).id === 'f2')
  t('no folder yet: named after the matching exam', () => suggestFolder('rizal-reviewer.pdf', [], ['Rizal midterm exam']).name === 'Rizal')
  t('no match at all: named after the file', () => suggestFolder('Accounting 2 notes.pdf', [], []).name === 'Accounting 2')
  t('each new folder looks different from the one before it', () => {
    const made: Folder[] = []
    for (const name of ['BIO101', 'Rizal', 'Calculus II', 'App Dev', 'Filipino 2', 'PE', 'NSTP']) made.push(newFolder(name, made))
    const tones = new Set(made.slice(0, 6).map((f) => f.style.tone))
    return tones.size === 6 && made.every((f, i) => i === 0 || (f.style.pattern !== made[i - 1].style.pattern && f.style.tab !== made[i - 1].style.tab))
  })
  return fails
}
