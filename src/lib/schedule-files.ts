import { openPdf } from './study-files'
import { MAX_FILE_BYTES, type LibraryFile } from './library'
import { validateScheduleSource, type PreparedImage, type ScheduleSource } from './schedule-source'

import { docxText } from './docx-text'

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result).split(',')[1])
  reader.onerror = () => reject(new Error('The image could not be read.'))
  reader.readAsDataURL(blob)
})
async function canvasImage(canvas: HTMLCanvasElement, page?: number): Promise<PreparedImage> {
  // Keep readable resolution; compress rather than repeatedly shrinking small text to fit.
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9))
  if (!blob) throw new Error('This image could not be prepared.')
  return { mimeType: 'image/jpeg', data: await dataUrl(blob), ...(page ? { page } : {}) }
}
export async function prepareScheduleImage(blob: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }) }
  catch { throw new Error('This image cannot be read. Use a valid PNG, JPEG, or WebP screenshot.') }
  try {
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvasImage(canvas)
  } finally { bitmap.close() }
}
export async function pdfScheduleInfo(blob: Blob) {
  try { const pdf = await openPdf(blob); try { return pdf.doc.numPages } finally { await pdf.close() } }
  catch (e) { throw pdfError(e) }
}
function pdfError(error: unknown) {
  return new Error(error instanceof Error && /password/i.test(error.name + error.message) ? 'This PDF is password-protected. Upload an unlocked copy.' : 'This PDF cannot be read. It may be corrupted or unsupported; upload another copy or a screenshot.')
}
export async function preparePdfPages(blob: Blob, pages: number[]): Promise<PreparedImage[]> {
  if (!pages.length || pages.length > 3) throw new Error('Select one to three PDF pages.')
  const pdf = await openPdf(blob).catch(e => { throw pdfError(e) })
  try {
    const prepared: PreparedImage[] = []
    for (const n of [...new Set(pages)].sort((a, b) => a - b)) {
      if (!Number.isInteger(n) || n < 1 || n > pdf.doc.numPages) throw new Error('Select valid PDF page numbers.')
      const page = await pdf.doc.getPage(n), natural = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2.5, 2560 / Math.max(natural.width, natural.height)) })
      const canvas = document.createElement('canvas'); canvas.width = Math.min(2560, Math.round(viewport.width)); canvas.height = Math.min(2560, Math.round(viewport.height))
      await page.render({ canvas, viewport }).promise
      prepared.push(await canvasImage(canvas, n))
      page.cleanup()
    }
    return prepared
  } catch (e) { if (e instanceof Error && /select|prepare/i.test(e.message)) throw e; throw pdfError(e) }
  finally { await pdf.close() }
}
export async function prepareScheduleFile(file: LibraryFile, pages = [1]): Promise<ScheduleSource> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Attachments must be 25 MB or smaller.')
  if (file.kind === 'docx') return validateScheduleSource({ type: 'text', content: await docxText(file.blob) })
  const images = file.kind === 'pdf' ? await preparePdfPages(file.blob, pages) : [await prepareScheduleImage(file.blob)]
  return validateScheduleSource({ type: 'images', pages: images })
}
