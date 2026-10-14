// Turning an attached file into a library file: its text per page (PDFs through pdf.js, loaded only when needed),
// its passages, and a flag for scans that have no text to read.
import { uid } from './core'
import { MAX_FILE_BYTES, saveFile, type LibraryFile } from './library'
import { chunkPages } from './study-material'

type PdfJs = typeof import('pdfjs-dist')
let pdfjs: Promise<PdfJs> | null = null
function loadPdfJs(): Promise<PdfJs> {
  return (pdfjs ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })())
}

/** The open document, and close() to free its worker when done */
export async function openPdf(blob: Blob) {
  const lib = await loadPdfJs()
  const task = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
  return { doc: await task.promise, close: () => task.destroy() }
}

/** Text per page, keeping line breaks so headings and "Term: definition" lines survive */
async function pdfPages(blob: Blob): Promise<string[]> {
  const { doc, close } = await openPdf(blob)
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent()
    let text = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      text += item.str + (item.hasEOL ? '\n' : '')
    }
    pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
  }
  await close()
  return pages
}

/** Plain text in pages of about 3,000 characters, split on blank lines */
function textPages(text: string): string[] {
  const out: string[] = []
  let page = ''
  for (const para of text.replace(/\r/g, '').split(/\n{2,}/)) {
    if (page && page.length + para.length > 3000) { out.push(page); page = '' }
    page += (page ? '\n\n' : '') + para
  }
  if (page.trim()) out.push(page)
  return out
}

export type ImportError = 'too-big' | 'unsupported' | 'unreadable'
export const IMPORT_ACCEPT = '.pdf,.txt,.md,image/*'

export async function importFile(file: File, folderId: string | null): Promise<LibraryFile | ImportError> {
  if (file.size > MAX_FILE_BYTES) return 'too-big'
  const kind: LibraryFile['kind'] | null = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf'
    : file.type.startsWith('image/') ? 'image'
    : file.type.startsWith('text/') || /\.(txt|md)$/i.test(file.name) ? 'text' : null
  if (!kind) return 'unsupported'
  let pages: string[] = []
  try {
    pages = kind === 'pdf' ? await pdfPages(file) : kind === 'text' ? textPages(await file.text()) : []
  } catch {
    return 'unreadable'
  }
  const words = pages.join(' ').split(/\s+/).filter(Boolean).length
  const entry: LibraryFile = {
    id: uid(), folderId, name: file.name, kind, size: file.size, blob: file, pages,
    chunks: chunkPages(pages),
    // A PDF of photos has (almost) no words: it can be viewed but not read aloud or quizzed
    scanned: kind === 'image' || (kind === 'pdf' && words < Math.max(20, pages.length * 5)),
    addedAt: Date.now(),
  }
  await saveFile(entry)
  return entry
}
