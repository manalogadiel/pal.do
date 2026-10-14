import SelectField from './SelectField'
import CardPractice from './CardPractice'
import { datedTasks, isTaskDone } from '../lib/tasks'
import { ToolChooser } from './StudyTools'
import type { StudyConfig } from '../lib/session'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDay, type PalId, type Task } from '../lib/core'
import { deleteFile, deleteFolder, getFile, moveFileToFolder, LIBRARY_EVENT, listFiles, listFolders, newFolder, saveFolder, type Folder, type LibraryFile } from '../lib/library'
import { readingPieces, readPiece, stopReading } from '../lib/native-tts'
import { IMPORT_ACCEPT, importFile, openPdf } from '../lib/study-files'
import { search, terms, titleFromFileName } from '../lib/study-material'
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
  onStudy?: (config: StudyConfig) => void
  browseFolderId?: string | null
  onBrowseDone?: () => void
}

/** The subject's next exam or deadline: a task whose title shares a word with the folder name */
function nextDue(folder: Folder, tasks: Task[], now: number) {
  const words = new Set(terms(folder.name))
  return datedTasks(tasks).filter((t) => t.due > now && terms(t.title).some((w) => words.has(w))).sort((a, b) => a.due - b.due)[0]
}

const initials = (name: string) => {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean)
  return (w.length > 1 ? w[0][0] + (/\d/.test(w[1]) ? w[1].replace(/\D/g, '').slice(0, 3) : w[1][0]) : (w[0] ?? '?').slice(0, 3)).toUpperCase()
}

/* ---------- One folder: its colour family, its paper, its tab, a pixel label, and sheets for its files ---------- */
function FolderArt({ folder, count, due, onOpen }: { folder: Folder; count: number; due?: Task & { due: number }; onOpen: () => void }) {
  const tab = ['left-4', 'left-1/2 -translate-x-1/2', 'right-4'][folder.style.tab]
  return (
    <button type="button" onClick={onOpen} className="folder press group relative block w-full pt-5 text-left" data-tone={folder.style.tone} aria-label={`${folder.name}, ${count} file${count === 1 ? '' : 's'}`}>
      <span className={`folder-back absolute top-1 h-8 w-[42%] rounded-t-[12px] ${tab}`} aria-hidden />
      {/* Sheets peeking out of the top: one per file, up to three */}
      {Array.from({ length: Math.min(count, 3) }, (_, i) => (
        <span key={i} aria-hidden className="absolute inset-x-4 h-10 rounded-[8px] bg-[#f5f9ff] shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-transform duration-300 [transition-timing-function:var(--ease-out)] group-hover:-translate-y-1" style={{ top: 9 + i * 3, rotate: `${[-2.5, 2, -0.75][i]}deg` }} />
      ))}
      <span className="folder-face relative flex min-h-[132px] flex-col justify-between rounded-[18px] p-3.5 shadow-[var(--edge),0_10px_24px_-14px_rgb(20_48_88/0.35)]" data-pattern={folder.style.pattern}>
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

export function Library({ pal, tasks, now, target, onTargetDone, onPlan, onToast, onStudy, browseFolderId, onBrowseDone }: Props) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loaded, setLoaded] = useState(false)
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const [open, setOpen] = useState<{ file: LibraryFile; mode: LibraryMode; topic?: string } | null>(null)
  const [toolFolder, setToolFolder] = useState<Folder | null>(null)
  useEffect(() => { if (!browseFolderId || !loaded) return; if (folders.some(f => f.id === browseFolderId)) { setOpenFolder(browseFolderId); setOpen(null) } else onToast('This folder is no longer available.'); onBrowseDone?.() }, [browseFolderId, folders, loaded])
  const [naming, setNaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    const load = () => Promise.all([listFolders(), listFiles()]).then(([fo, fi]) => { if (alive) { setFolders(fo); setFiles(fi); setLoaded(true) } }).catch(() => {})
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
      else if (r === 'unsupported') onToast(`${file.name}: use PDF, DOCX, TXT, Markdown, PNG, JPEG, or WebP.`)
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

  if (toolFolder) return <ToolChooser folder={toolFolder} tasks={tasks} onClose={() => setToolFolder(null)} onOpen={c => { setToolFolder(null); onStudy?.(c) }} onBrowse={() => { setOpenFolder(toolFolder.id); setToolFolder(null) }} />

  const displayFolder=folder??(open?{id:'',name:'Chat attachment',createdAt:0,style:{tone:'class' as const,pattern:'lines' as const,tab:0 as const}}:undefined)
  if (open && displayFolder) return <FileView key={open.file.id + open.mode} file={open.file} folder={displayFolder} mode={open.mode} topic={open.topic} pal={pal} onMode={(mode) => setOpen({ ...open, mode, topic: undefined })} onBack={() => { stopReading(); setOpen(null) }} onPlan={()=>folder?onPlan(open.file,folder):onToast('Move this file to a folder before planning study.')} />

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

        <button className="press mt-4 h-11 self-start rounded-full bg-accent-soft px-5 text-sm font-medium" onClick={() => setToolFolder(folder)}>Study this folder</button>
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
          <h2 className="font-serif text-[40px] leading-none">Folders</h2>
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
      {files.some(f=>f.folderId===null)&&<section className="mt-6"><h3 className="font-medium">Chat attachments</h3><ul className="mt-3 space-y-3">{files.filter(f=>f.folderId===null).map(f=><li key={f.id} className="flex flex-wrap items-center gap-3 rounded-[16px] bg-paper/80 p-3"><button className="flex-1 min-w-0 text-left break-words" onClick={()=>setOpen({file:f,mode:'read'})}>{f.name}</button><label className="text-sm">Move to folder<SelectField aria-label={`Move ${f.name} to folder`} value="" onValueChange={v=>{if(v)void moveFileToFolder(f.id,v).catch(err=>onToast(err.message))}} options={[{value:'',label:'Choose a folder'},...folders.map(folder=>({value:folder.id,label:folder.name}))]} /></label></li>)}</ul></section>}
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
  const tabs: [LibraryMode, string][] = file.scanned ? [['read', 'Read']] : [['read', 'Read'], ['cards', 'Flashcards'], ['quiz','Quiz']]
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
        {mode === 'read' ? <Reader file={file} pal={pal} /> : <CardPractice key={`${file.id}:${topic??''}`} file={file} pal={pal} topic={topic} initialMode={mode==='quiz'?'quiz':'swipe'} />}
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
  const [readError, setReadError] = useState('')
  const playingRef = useRef(false)
  async function play(from = 0) {
    playingRef.current = true
    setPlaying(true)
    setReadError('')
    for (let i = from; i < pieces.length && playingRef.current; i++) {
      setPiece(i)
      try { await readPiece(pieces[i], pal) } catch (err) { playingRef.current = false; setPlaying(false); setReadError(err instanceof Error ? err.message : 'Voice unavailable.'); return }
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
      {readError && <p role="status" className="mx-4 my-2 text-sm text-ink-2">{readError}</p>}
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

export default Library
