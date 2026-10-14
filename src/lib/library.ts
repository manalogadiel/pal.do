import type { CardMode, CardProgress } from './card-practice'
// The Study library: folders of reviewers, PDFs and notes, kept on this device (IndexedDB, works offline and in the
// Android app). Files can be big, so they live here, not in the paldo-v1 localStorage save.
import { uid } from './core'
import type { Card as Flashcard, Chunk, QuizItem } from './study-material'

export interface FolderStyle {
  /** One of the calendar's colour families, so a folder matches its subject's events */
  tone: 'class' | 'exam' | 'sage' | 'sand' | 'shift' | 'lilac'
  pattern: 'plain' | 'lines' | 'grid' | 'dots' | 'stripes'
  /** Tab on the left, middle or right, like a real folder */
  tab: 0 | 1 | 2
}
export interface Folder {
  id: string
  name: string
  style: FolderStyle
  createdAt: number
}
export interface LibraryFile {
  id: string
  folderId: string | null
  name: string
  kind: 'pdf' | 'image' | 'text'
  size: number
  blob: Blob
  /** Text per page ('' for a page with no text layer) */
  pages: string[]
  chunks: Chunk[]
  /** A scan: it can be viewed, but there's no text to quiz or read aloud */
  scanned: boolean
  addedAt: number
}
export interface Deck {
  fileId: string
  cards: Flashcard[]
  /** 'app': pulled out by the app's own rules; 'ai': written by the cloud model from the file's text */
  source: 'app' | 'ai'
  madeAt: number
}
export interface Quiz {
  fileId: string
  items: QuizItem[]
  source: 'app' | 'ai'
  madeAt: number
}

export const LIBRARY_EVENT = 'paldo-library-change'
export const MAX_FILE_BYTES = 25 * 1024 * 1024
const DB = 'paldo-library'
const STORES = ['folders', 'files', 'decks', 'quizzes', 'cardProgress'] as const
type Store = (typeof STORES)[number]

let opening: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  return (opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' }).createIndex('folderId', 'folderId')
      if (!d.objectStoreNames.contains('decks')) d.createObjectStore('decks', { keyPath: 'fileId' })
      if (!d.objectStoreNames.contains('quizzes')) d.createObjectStore('quizzes', { keyPath: 'fileId' })
      if (!d.objectStoreNames.contains('cardProgress')) d.createObjectStore('cardProgress', {keyPath:'key'}).createIndex('fileId','fileId')
    }
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opening = null }; resolve(req.result) }
    req.onerror = () => { opening = null; reject(req.error) }
  }))
}

function run<T>(store: Store, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode)
    const req = body(tx.objectStore(store))
    tx.oncomplete = () => {
      resolve(req ? req.result : (undefined as T))
      if (mode === 'readwrite' && store !== 'cardProgress') window.dispatchEvent(new Event(LIBRARY_EVENT))
    }
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

export const listFolders = () => run<Folder[]>('folders', 'readonly', (s) => s.getAll()).then((f) => f.sort((a, b) => a.createdAt - b.createdAt))
export const saveFolder = (f: Folder) => run('folders', 'readwrite', (s) => s.put(f))
export const listFiles = (folderId?: string) =>
  run<LibraryFile[]>('files', 'readonly', (s) => (folderId ? s.index('folderId').getAll(folderId) : s.getAll())).then((f) => f.sort((a, b) => b.addedAt - a.addedAt))
export const getFile = (id: string) => run<LibraryFile | undefined>('files', 'readonly', (s) => s.get(id))
export const saveFile = (f: LibraryFile) => run('files', 'readwrite', (s) => s.put(f))
export const getDeck = (fileId: string) => run<Deck | undefined>('decks', 'readonly', (s) => s.get(fileId))
export const saveDeck = (d: Deck) => run('decks', 'readwrite', (s) => s.put(d))
export const getQuiz = (fileId: string) => run<Quiz | undefined>('quizzes', 'readonly', (s) => s.get(fileId))
export const saveQuiz = (q: Quiz) => run('quizzes', 'readwrite', (s) => s.put(q))

export async function deleteFile(id: string) {
  await run('files', 'readwrite', (s) => s.delete(id))
  await run('decks', 'readwrite', (s) => s.delete(id))
  await run('quizzes', 'readwrite', (s) => s.delete(id))
  const progress = await getCardProgress(id)
  for (const p of progress) await run('cardProgress','readwrite',s=>s.delete(p.key))
}
export async function deleteFolder(id: string) {
  for (const f of await listFiles(id)) await deleteFile(f.id)
  await run('folders', 'readwrite', (s) => s.delete(id))
}

/** A new folder gets its own look: a colour family, paper and tab position that differ from the folder before it */
export function newFolder(name: string, existing: Folder[]): Folder {
  const tones: FolderStyle['tone'][] = ['class', 'exam', 'sage', 'sand', 'lilac', 'shift']
  const patterns: FolderStyle['pattern'][] = ['lines', 'grid', 'dots', 'stripes', 'plain']
  const n = existing.length
  // Name-seeded so the same subject tends to get the same look, stepped so neighbours never match
  const seed = [...name.toLowerCase()].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  // The name's colour, unless another folder already has it: then the next free one
  const used = new Set(existing.map((f) => f.style.tone))
  const order = tones.map((_, i) => tones[(seed + i) % tones.length])
  const tone = order.find((t) => !used.has(t)) ?? order[n % tones.length]
  // Paper and tab never repeat the folder right before it
  const last = existing.at(-1)?.style
  const pattern = patterns.map((_, i) => patterns[(seed + n + i) % patterns.length]).find((p) => p !== last?.pattern)!
  const tab = ([0, 1, 2] as const).map((i) => ((seed + n + i) % 3) as 0 | 1 | 2).find((t) => t !== last?.tab)!
  return { id: uid(), name: name.trim() || 'Untitled', createdAt: Date.now(), style: { tone, pattern, tab } }
}

export const getCardProgress = (fileId: string) => run<CardProgress[]>('cardProgress','readonly',s=>s.index('fileId').getAll(fileId))
export async function recordCardResult(key: string, mode: CardMode, correct: boolean, now=Date.now()): Promise<CardProgress> {
  const d=await db()
  return new Promise((resolve,reject)=>{
    const tx=d.transaction('cardProgress','readwrite'), store=tx.objectStore('cardProgress'), req=store.get(key)
    let result: CardProgress
    req.onsuccess=()=>{
      const old=req.result as CardProgress | undefined
      const previous=old?.modes[mode] ?? {attempts:0,correct:0}
      result={key,fileId:JSON.parse(key)[0],attempts:(old?.attempts??0)+1,correct:(old?.correct??0)+Number(correct),lastReviewedAt:now,modes:{...old?.modes,[mode]:{attempts:previous.attempts+1,correct:previous.correct+Number(correct)}}}
      store.put(result)
    }
    tx.oncomplete=()=>resolve(result)
    tx.onerror=()=>reject(tx.error)
    tx.onabort=()=>reject(tx.error)
  })
}

export async function moveFileToFolder(fileId:string,folderId:string):Promise<void>{
 const d=await db()
 return new Promise((resolve,reject)=>{const tx=d.transaction(['files','folders'],'readwrite'),files=tx.objectStore('files'),file=files.get(fileId),folder=tx.objectStore('folders').get(folderId);let pending=2
 const commit=()=>{if(--pending)return;if(!file.result||!folder.result){tx.abort();return}files.put({...file.result,folderId})}
 file.onsuccess=commit;folder.onsuccess=commit
 tx.oncomplete=()=>{window.dispatchEvent(new Event(LIBRARY_EVENT));resolve()};tx.onabort=()=>reject(new Error('The file or folder is no longer available.'));tx.onerror=()=>reject(tx.error)
 })
}
