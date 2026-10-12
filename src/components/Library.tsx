import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDay, type PalId, type Task } from '../lib/core'
import { generateStudyAids } from '../lib/groq'
import { deleteFile, deleteFolder, getDeck, getFile, getQuiz, LIBRARY_EVENT, listFiles, listFolders, newFolder, saveDeck, saveFolder, saveQuiz, type Deck, type Folder, type LibraryFile, type Quiz } from '../lib/library'
import { readingPieces, readPiece, stopReading } from '../lib/native-tts'
import { IMPORT_ACCEPT, importFile, openPdf } from '../lib/study-files'
import { extractCards, quizFromCards, search, terms, titleFromFileName } from '../lib/study-material'
import { Calendar, Cards, ChevronL, ChevronR, Clip, Pause, Play, Plus, Quiz as QuizIcon, Speaker, Trash } from './Icons'

export type LibraryMode = 'read' | 'cards' | 'quiz'
export interface LibraryTarget { fileId: string; mode: LibraryMode; topic?: string }

interface Props {
  pal: PalId
  tasks: Task[]
  now: number
  /** Opened from chat ("Quiz me" on an attachment card) */
  target?: LibraryTarget | null
  onTargetDone?: () => void
  onPlan: (file: LibraryFile, folder: Folder) => void
  onToast: (text: string) => void
}

/** The subject's next exam or deadline: a task whose title shares a word with the folder name */
function nextDue(folder: Folder, tasks: Task[], now: number) {
  const words = new Set(terms(folder.name))
  return tasks.filter((t) => t.due > now && terms(t.title).some((w) => words.has(w))).sort((a, b) => a.due - b.due)[0]
}

const initials = (name: string) => {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  return (w.length > 1 ? w[0][0] + (/\d/.test(w[1]) ? w[1].replace(/\D/g, '').slice(0, 3) : w[1][0]) : (w[0] ?? '?').slice(0, 3)).toUpperCase()
}

/* ---------- One folder: its colour family, its paper, its tab, a pixel label, and sheets for its files ---------- */
function FolderArt({ folder, count, due, onOpen }: { folder: Folder; count: number; due?: Task; onOpen: () => void }) {
  const tab = ['left-4', 'left-1/2 -translate-x-1/2', 'right-4'][folder.style.tab]
  return (
    <button type="button" onClick={onOpen} className="folder press group relative block w-full pt-5 text-left" data-tone={folder.style.tone} aria-label={`${folder.name}, ${count} file${count === 1 ? '' : 's'}`}>
      <span className={`folder-back absolute top-1 h-8 w-[42%] rounded-t-[12px] ${tab}`} aria-hidden />
      {/* Sheets peeking out of the top: one per file, up to three */}
      {Array.from({ length: Math.min(count, 3) }, (_, i) => (
        <span key={i} aria-hidden className="absolute inset-x-4 h-10 rounded-[8px] bg-[#fbf9f5] shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-transform duration-300 [transition-timing-function:var(--ease-out)] group-hover:-translate-y-1" style={{ top: 9 + i * 3, rotate: `${[-2.5, 2, -0.75][i]}deg` }} />
      ))}
      <span className="folder-face relative flex min-h-[132px] flex-col justify-between rounded-[18px] p-3.5 shadow-[var(--edge),0_10px_24px_-14px_rgb(60_44_30/0.35)]" data-pattern={folder.style.pattern}>
        <span className="folder-sticker inline-block self-start rotate-[-3deg] px-2 py-1 text-[13px] leading-none">{initials(folder.name)}</span>
        <span>
          <span className="block font-serif text-[22px] leading-[1.05]">{folder.name}</span>
          <span className="mt-1 block text-[11.5px] opacity-80">
            {count ? `${count} file${count === 1 ? '' : 's'}` : 'Empty'}{due ? `, ${due.kind === 'exam' ? 'exam' : 'due'} ${fmtDay(due.due).replace(/,.*/, '')}` : ''}
          </span>
        </span>
      </span>
    </button>
  )
}

export function Library({ pal, tasks, now, target, onTargetDone, onPlan, onToast }: Props) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const [open, setOpen] = useState<{ file: LibraryFile; mode: LibraryMode; topic?: string } | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    const load = () => Promise.all([listFolders(), listFiles()]).then(([fo, fi]) => { if (alive) { setFolders(fo); setFiles(fi) } }).catch(() => {})
    load()
    window.addEventListener(LIBRARY_EVENT, load)
    return () => { alive = false; window.removeEventListener(LIBRARY_EVENT, load) }
  }, [])

  // From chat: open that file in that mode
  useEffect(() => {
    if (!target) return
    void getFile(target.fileId).then((f) => {
      if (f) { setOpenFolder(f.folderId); setOpen({ file: f, mode: target.mode, topic: target.topic }) }
      onTargetDone?.()
    })
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps

  const folder = folders.find((f) => f.id === openFolder)
  const inFolder = files.filter((f) => f.folderId === openFolder)

  async function addFiles(list: FileList | null) {
    if (!list?.length || !folder) return
    setBusy(true)
    for (const file of [...list]) {
      const r = await importFile(file, folder.id)
      if (r === 'too-big') onToast(`${file.name} is over 25 MB.`)
      else if (r === 'unsupported') onToast(`${file.name}: PDF, text or image files only.`)
      else if (r === 'unreadable') onToast(`${file.name} couldn't be opened. Is it password-protected?`)
    }
    setBusy(false)
  }
  async function createFolder(name: string) {
    const f = newFolder(name, folders)
    await saveFolder(f)
    setNaming(null)
    setOpenFolder(f.id)
  }

  if (open && folder) return <FileView key={open.file.id + open.mode} file={open.file} folder={folder} mode={open.mode} topic={open.topic} pal={pal} onMode={(mode) => setOpen({ ...open, mode, topic: undefined })} onBack={() => { stopReading(); setOpen(null) }} onPlan={() => onPlan(open.file, folder)} />

  /* ---------- Inside a folder ---------- */
  if (folder) {
    const due = nextDue(folder, tasks, now)
    return (
      <div className="folder flex h-full flex-col overflow-y-auto px-4 pt-4 pb-10 sm:px-6" data-tone={folder.style.tone}>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOpenFolder(null)} className="press -ml-2 flex h-9 items-center gap-1 rounded-full pr-3 pl-2 text-[13px] text-ink-2 hover:bg-ink/[0.05]"><ChevronL /> Library</button>
          <div className="flex-1" />
          <button type="button" onClick={() => { if (confirm(`Delete the ${folder.name} folder and its ${inFolder.length} file${inFolder.length === 1 ? '' : 's'}?`)) { void deleteFolder(folder.id); setOpenFolder(null) } }} className="press grid size-9 place-items-center rounded-full text-ink-3 hover:bg-ink/[0.05]" aria-label="Delete folder"><Trash /></button>
        </div>
        <div className="folder-face mt-2 flex items-end justify-between gap-3 rounded-[22px] p-4" data-pattern={folder.style.pattern}>
          <div className="min-w-0">
            <span className="folder-sticker inline-block rotate-[-3deg] px-2 py-1 text-[13px] leading-none">{initials(folder.name)}</span>
            <h2 className="mt-3 font-serif text-[34px] leading-none">{folder.name}</h2>
            {due && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] opacity-85"><Calendar className="size-3.5" />{due.title}, {fmtDay(due.due)}</p>}
          </div>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[13.5px] font-medium text-paper disabled:opacity-60">
            <Clip /> {busy ? 'Adding…' : 'Add file'}
          </button>
          <input ref={input} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
        </div>

        {inFolder.length === 0 ? (
          <div className="mt-8 max-w-[340px] self-center text-center text-[14px] leading-relaxed text-ink-2">
            Add a reviewer, handout or notes. Pal can plan study time from it, make flashcards and a practice quiz, and read it to you.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {inFolder.map((f) => (
              <li key={f.id} className="rounded-[18px] bg-paper/80 p-3.5 shadow-[var(--edge)]">
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => setOpen({ file: f, mode: 'read' })} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{titleFromFileName(f.name)}</span>
                    <span className="block text-[12px] text-ink-3">
                      {f.kind === 'image' ? 'Image' : `${f.pages.length} page${f.pages.length === 1 ? '' : 's'}`}{f.scanned && f.kind !== 'image' ? ', scanned (no text to read)' : ''}
                    </span>
                  </button>
                  <button type="button" onClick={() => { if (confirm(`Delete ${f.name}?`)) void deleteFile(f.id) }} className="press grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-ink/[0.05]" aria-label={`Delete ${f.name}`}><Trash className="size-3.5" /></button>
                </div>
                {!f.scanned && (
                  <div className="mt-2.5 -ml-1 flex flex-wrap gap-1">
                    <Chip onClick={() => onPlan(f, folder)}><Calendar className="size-3.5" /> Plan study</Chip>
                    <Chip onClick={() => setOpen({ file: f, mode: 'cards' })}><Cards className="size-3.5" /> Flashcards</Chip>
                    <Chip onClick={() => setOpen({ file: f, mode: 'quiz' })}><QuizIcon className="size-3.5" /> Quiz me</Chip>
                    <Chip onClick={() => setOpen({ file: f, mode: 'read' })}><Speaker className="size-3.5" /> Read aloud</Chip>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  /* ---------- All folders ---------- */
  return (
    <div className="h-full overflow-y-auto px-4 pt-5 pb-10 sm:px-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-[40px] leading-none">Library</h2>
          <p className="mt-1.5 text-[13px] text-ink-3">Your reviewers and notes, by subject. Kept on this device.</p>
        </div>
        {naming == null && <button type="button" onClick={() => setNaming('')} className="press flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[13.5px] font-medium text-paper"><Plus /> Folder</button>}
      </div>
      {naming != null && (
        <form onSubmit={(e) => { e.preventDefault(); if (naming.trim()) void createFolder(naming) }} className="pop mt-4 flex gap-2">
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Subject, like Bio 101" className="min-w-0 flex-1 rounded-full bg-ink/[0.05] px-4 py-2.5 text-[14px] outline-none placeholder:text-ink-3 focus:bg-ink/[0.08]" />
          <button type="submit" disabled={!naming.trim()} className="press h-10 rounded-full bg-ink px-4 text-[13.5px] font-medium text-paper disabled:opacity-40">Create</button>
          <button type="button" onClick={() => setNaming(null)} className="press h-10 rounded-full px-3 text-[13.5px] text-ink-2">Cancel</button>
        </form>
      )}
      {folders.length === 0 && naming == null ? (
        <div className="mt-10 max-w-[360px] text-[14px] leading-relaxed text-ink-2">
          Make a folder for each subject, or attach a reviewer in the chat with the <Clip className="inline size-3.5 align-[-2px]" /> button and Pal files it for you.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {folders.map((f) => <FolderArt key={f.id} folder={f} count={files.filter((x) => x.folderId === f.id).length} due={nextDue(f, tasks, now)} onOpen={() => setOpenFolder(f.id)} />)}
        </div>
      )}
    </div>
  )
}

const Chip = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="press flex h-8 items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 text-[12.5px] font-medium text-ink hover:bg-ink/[0.09]">{children}</button>
)

/* ---------- One file: read it (and hear it), flip its flashcards, or take its quiz ---------- */
function FileView({ file, folder, mode, topic, pal, onMode, onBack, onPlan }: { file: LibraryFile; folder: Folder; mode: LibraryMode; topic?: string; pal: PalId; onMode: (m: LibraryMode) => void; onBack: () => void; onPlan: () => void }) {
  const tabs: [LibraryMode, string][] = file.scanned ? [['read', 'Read']] : [['read', 'Read'], ['cards', 'Flashcards'], ['quiz', 'Quiz']]
  return (
    <div className="folder flex h-full flex-col overflow-hidden" data-tone={folder.style.tone}>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-4 sm:px-6">
        <button type="button" onClick={onBack} className="press -ml-2 flex h-9 shrink-0 items-center gap-1 rounded-full pr-3 pl-2 text-[13px] text-ink-2 hover:bg-ink/[0.05]"><ChevronL /> {folder.name}</button>
        <div className="flex-1" />
        {!file.scanned && <button type="button" onClick={onPlan} className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] text-ink-2 hover:bg-ink/[0.05]"><Calendar className="size-3.5" /> Plan study</button>}
      </div>
      <div className="shrink-0 px-4 sm:px-6">
        <h2 className="mt-1 truncate font-serif text-[28px] leading-tight">{titleFromFileName(file.name)}</h2>
        {tabs.length > 1 && (
          <div className="mt-2 inline-flex rounded-full bg-ink/[0.05] p-1" role="tablist">
            {tabs.map(([m, label]) => (
              <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => onMode(m)} className={`press h-8 rounded-full px-3.5 text-[13px] ${mode === m ? 'bg-paper font-medium shadow-sm' : 'text-ink-2'}`}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 sm:px-6">
        {mode === 'read' ? <Reader file={file} pal={pal} /> : mode === 'cards' ? <Flashcards file={file} pal={pal} topic={topic} /> : <QuizPlayer file={file} topic={topic} />}
      </div>
    </div>
  )
}

/* ---------- Reading: the page itself (PDF rendered, or the text), and Pal reading it out ---------- */
function Reader({ file, pal }: { file: LibraryFile; pal: PalId }) {
  const [page, setPage] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [piece, setPiece] = useState(-1)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const pdf = useRef<Awaited<ReturnType<typeof openPdf>> | null>(null)
  const total = Math.max(1, file.pages.length)
  const imageUrl = useMemo(() => (file.kind === 'image' ? URL.createObjectURL(file.blob) : ''), [file])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  useEffect(() => () => { stopReading(); void pdf.current?.close() }, [])

  useEffect(() => {
    if (file.kind !== 'pdf') return
    let cancelled = false
    void (async () => {
      pdf.current ??= await openPdf(file.blob)
      const p = await pdf.current.doc.getPage(page)
      if (cancelled || !canvas.current || !box.current) return
      const width = box.current.clientWidth
      const base = p.getViewport({ scale: 1 })
      const scale = (width / base.width) * Math.min(2, window.devicePixelRatio || 1)
      const vp = p.getViewport({ scale })
      canvas.current.width = vp.width
      canvas.current.height = vp.height
      canvas.current.style.width = `${width}px`
      await p.render({ canvas: canvas.current, viewport: vp }).promise
    })().catch(() => {})
    return () => { cancelled = true }
  }, [file, page])

  const pieces = useMemo(() => readingPieces(file.pages[page - 1] ?? ''), [file, page])
  const playingRef = useRef(false)
  async function play(from = 0) {
    playingRef.current = true
    setPlaying(true)
    for (let i = from; i < pieces.length && playingRef.current; i++) {
      setPiece(i)
      await readPiece(pieces[i], pal)
    }
    if (playingRef.current && page < total) { setPage((p) => p + 1); setPiece(-1) }
    else { playingRef.current = false; setPlaying(false); setPiece(-1) }
  }
  // Reading on: the next page starts by itself
  useEffect(() => { if (playingRef.current && piece === -1) void play(0) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
  function stop() { playingRef.current = false; setPlaying(false); setPiece(-1); stopReading() }
  const go = (d: number) => { stop(); setPage((p) => Math.min(total, Math.max(1, p + d))) }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-center gap-2 rounded-full bg-paper/90 p-1 shadow-[var(--edge)] backdrop-blur">
        <button type="button" onClick={() => go(-1)} disabled={page <= 1} className="press grid size-9 place-items-center rounded-full text-ink-2 disabled:opacity-30" aria-label="Previous page"><ChevronL /></button>
        <span className="tnum text-[12.5px] text-ink-2">Page {page} of {total}</span>
        <button type="button" onClick={() => go(1)} disabled={page >= total} className="press grid size-9 place-items-center rounded-full text-ink-2 disabled:opacity-30" aria-label="Next page"><ChevronR /></button>
        <div className="flex-1" />
        {pieces.length > 0 && (
          <button type="button" onClick={() => (playing ? stop() : void play(Math.max(0, piece)))} className="press flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-paper">
            {playing ? <><Pause className="size-3.5" /> Stop</> : <><Play className="size-3.5" /> Read aloud</>}
          </button>
        )}
      </div>
      {file.kind === 'image' ? (
        <img src={imageUrl} alt={file.name} className="w-full rounded-[14px]" />
      ) : file.kind === 'pdf' ? (
        <div ref={box} className="overflow-hidden rounded-[14px] bg-white shadow-[var(--edge)]"><canvas ref={canvas} className="block" /></div>
      ) : (
        <div ref={box} className="whitespace-pre-wrap rounded-[14px] bg-paper p-4 text-[15px] leading-relaxed shadow-[var(--edge)]">{file.pages[page - 1]}</div>
      )}
      {playing && piece >= 0 && <p className="pop mt-3 rounded-[14px] bg-ink/[0.04] p-3 text-[14px] leading-relaxed text-ink" aria-live="polite">{pieces[piece]}</p>}
      {file.scanned && file.kind === 'pdf' && <p className="mt-3 text-[12.5px] text-ink-3">This PDF is scanned pages, so there's no text for Pal to read out or quiz you on.</p>}
    </div>
  )
}

/** Which passages a topic means ("quiz me on osmosis"), or the whole reviewer */
const passagesFor = (file: LibraryFile, topic?: string) => (topic ? search(file.chunks, topic, 4) : file.chunks.slice(0, 6))

/* ---------- Flashcards: the app's own from "Term: definition" lines, or better ones from the cloud ---------- */
function Flashcards({ file, pal, topic }: { file: LibraryFile; pal: PalId; topic?: string }) {
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined)
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [making, setMaking] = useState(false)

  useEffect(() => {
    void getDeck(file.id).then(async (d) => {
      if (d && !topic) return setDeck(d)
      const cards = extractCards(topic ? passagesFor(file, topic) : file.chunks)
      const own: Deck = { fileId: file.id, cards, source: 'app', madeAt: Date.now() }
      if (!topic && cards.length) await saveDeck(own)
      setDeck(cards.length ? own : null)
      if (!cards.length) void better()
    })
  }, [file, topic]) // eslint-disable-line react-hooks/exhaustive-deps

  async function better() {
    setMaking(true)
    const cards = await generateStudyAids('cards', passagesFor(file, topic), topic)
    setMaking(false)
    if (!cards || !('front' in (cards[0] ?? {}))) return
    const d: Deck = { fileId: file.id, cards: (cards as { front: string; back: string; page?: number }[]).map((c, n) => ({ id: `a${n + 1}`, ...c })), source: 'ai', madeAt: Date.now() }
    if (!topic) await saveDeck(d)
    setDeck(d); setI(0); setFlipped(false)
  }

  if (deck === undefined) return <p className="text-[14px] text-ink-3">Getting the cards ready…</p>
  if (!deck) return <p className="max-w-[360px] text-[14px] leading-relaxed text-ink-2">{making ? 'Writing flashcards from this file…' : 'No "term: definition" lines in this file, and the cloud AI isn\'t available right now to write cards. Try again when you\'re online.'}</p>
  const card = deck.cards[i]
  const next = (d: number) => { stopReading(); setFlipped(false); setI((x) => (x + d + deck.cards.length) % deck.cards.length) }
  return (
    <div className="mx-auto max-w-[460px]">
      <button type="button" onClick={() => setFlipped((f) => !f)} className="block w-full [perspective:1200px]" aria-label={flipped ? 'Show the term' : 'Show the answer'}>
        <div className="flip relative min-h-[220px]" data-flipped={flipped}>
          <div className="folder-face absolute inset-0 flex flex-col items-center justify-center rounded-[22px] p-6 text-center shadow-[var(--edge),var(--shadow-lg)]" data-pattern="lines">
            <span className="font-serif text-[30px] leading-tight">{card.front}</span>
            <span className="mt-3 text-[12px] opacity-70">Tap to flip</span>
          </div>
          <div className="flip-back absolute inset-0 flex items-center justify-center rounded-[22px] bg-paper p-6 text-center text-[16px] leading-relaxed text-ink shadow-[var(--edge),var(--shadow-lg)]">{card.back}</div>
        </div>
      </button>
      <div className="mt-4 flex items-center gap-2">
        <button type="button" onClick={() => next(-1)} className="press grid size-10 place-items-center rounded-full bg-ink/[0.05]" aria-label="Previous card"><ChevronL /></button>
        <span className="tnum flex-1 text-center text-[13px] text-ink-2">{i + 1} of {deck.cards.length}{card.page ? `, page ${card.page}` : ''}</span>
        <button type="button" onClick={() => { void readPiece(card.front, pal).then(() => new Promise((r) => setTimeout(r, 1200))).then(() => { setFlipped(true); return readPiece(card.back, pal) }) }} className="press grid size-10 place-items-center rounded-full bg-ink/[0.05]" aria-label="Read this card aloud"><Speaker /></button>
        <button type="button" onClick={() => next(1)} className="press grid size-10 place-items-center rounded-full bg-ink/[0.05]" aria-label="Next card"><ChevronR /></button>
      </div>
      <p className="mt-4 text-center text-[12px] text-ink-3">
        {deck.source === 'ai' ? 'Written by the cloud AI from this file only.' : 'Pulled from this file\'s own definitions.'}{' '}
        {deck.source === 'app' && <button type="button" disabled={making} onClick={() => void better()} className="underline disabled:no-underline disabled:opacity-60">{making ? 'Writing better ones…' : 'Make better cards with AI'}</button>}
      </p>
    </div>
  )
}

/* ---------- Practice quiz ---------- */
function QuizPlayer({ file, topic }: { file: LibraryFile; topic?: string }) {
  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined)
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [making, setMaking] = useState(false)

  async function make(fresh = false) {
    setMaking(true); setI(0); setPicked(null); setScore(0)
    const saved = fresh || topic ? undefined : await getQuiz(file.id)
    if (saved) { setQuiz(saved); setMaking(false); return }
    // The cloud writes real questions; otherwise the app builds one from the flashcards
    const ai = await generateStudyAids('quiz', passagesFor(file, topic), topic)
    let q: Quiz | null = null
    if (ai && 'question' in (ai[0] ?? {})) q = { fileId: file.id, items: (ai as { question: string; choices: string[]; answer: number; page?: number }[]).map((x, n) => ({ id: `a${n + 1}`, ...x })), source: 'ai', madeAt: Date.now() }
    else {
      const deck = await getDeck(file.id)
      const items = quizFromCards(deck?.cards.length ? deck.cards : extractCards(topic ? passagesFor(file, topic) : file.chunks), 8)
      if (items.length) q = { fileId: file.id, items, source: 'app', madeAt: Date.now() }
    }
    if (q && !topic) await saveQuiz(q)
    setQuiz(q)
    setMaking(false)
  }
  useEffect(() => { void make() }, [file, topic]) // eslint-disable-line react-hooks/exhaustive-deps

  if (quiz === undefined || making) return <p className="text-[14px] text-ink-3">Writing your quiz…</p>
  if (!quiz) return <p className="max-w-[360px] text-[14px] leading-relaxed text-ink-2">This file needs at least four "term: definition" lines for a quiz, or the cloud AI to write one. Try again when you're online.</p>
  if (i >= quiz.items.length) return (
    <div className="mx-auto max-w-[460px] text-center">
      <p className="font-serif text-[44px] leading-none">{score} of {quiz.items.length}</p>
      <p className="mt-2 text-[14px] text-ink-2">{score === quiz.items.length ? 'Every one. Nice.' : 'Review the ones you missed, then try a fresh set.'}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={() => { setI(0); setPicked(null); setScore(0) }} className="press h-10 rounded-full bg-ink/[0.05] px-4 text-[13.5px]">Same questions</button>
        <button type="button" onClick={() => void make(true)} className="press h-10 rounded-full bg-ink px-4 text-[13.5px] font-medium text-paper">New quiz</button>
      </div>
    </div>
  )
  const q = quiz.items[i]
  return (
    <div className="mx-auto max-w-[520px]">
      <p className="tnum text-[12.5px] text-ink-3">Question {i + 1} of {quiz.items.length}{q.page ? `, from page ${q.page}` : ''}</p>
      <p className="mt-1.5 font-serif text-[24px] leading-snug">{q.question}</p>
      <ul className="mt-4 space-y-2">
        {q.choices.map((c, n) => {
          const state = picked == null ? '' : n === q.answer ? 'right' : n === picked ? 'wrong' : 'dim'
          return (
            <li key={n}>
              <button type="button" disabled={picked != null} onClick={() => { setPicked(n); if (n === q.answer) setScore((s) => s + 1) }}
                className={`press w-full rounded-[16px] px-4 py-3 text-left text-[14.5px] leading-snug transition-colors ${state === 'right' ? 'bg-[var(--ev-sage)] text-[var(--ev-sage-ink)] shadow-[inset_0_0_0_2px_var(--ev-sage-rule)]' : state === 'wrong' ? 'bg-[var(--ev-exam)] text-[var(--ev-exam-ink)] shadow-[inset_0_0_0_2px_var(--ev-exam-rule)]' : state === 'dim' ? 'bg-ink/[0.03] text-ink-3' : 'bg-ink/[0.05] text-ink hover:bg-ink/[0.08]'}`}>
                {c}
              </button>
            </li>
          )
        })}
      </ul>
      {picked != null && (
        <div className="pop mt-4 flex items-center justify-between gap-3">
          <p className="text-[13.5px] text-ink-2">{picked === q.answer ? 'Right.' : `It's “${q.choices[q.answer]}”.`}</p>
          <button type="button" onClick={() => { setI(i + 1); setPicked(null) }} className="press h-10 shrink-0 rounded-full bg-ink px-4 text-[13.5px] font-medium text-paper">{i + 1 < quiz.items.length ? 'Next' : 'See score'}</button>
        </div>
      )}
      <p className="mt-6 text-[12px] text-ink-3">{quiz.source === 'ai' ? 'Written by the cloud AI from this file only.' : 'Built from this file\'s own definitions.'}</p>
    </div>
  )
}

export default Library
