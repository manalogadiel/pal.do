export interface PreparedImage { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; page?: number }
export type ScheduleSource = { type: 'images'; pages: PreparedImage[] } | { type: 'text'; content: string }
export const MAX_SCHEDULE_IMAGES = 3_000_000
export const MAX_SCHEDULE_REQUEST = 4_500_000
export function supportedScheduleFile(file: { name: string; blob: { type: string } }) {
  return /\.(png|jpe?g|webp|pdf|docx)$/i.test(file.name) || /^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.blob.type)
}
export function validateScheduleSource(value: unknown): ScheduleSource {
  if (!value || typeof value !== 'object') throw new Error('Invalid schedule source.')
  const x = value as Record<string, unknown>
  if (x.type === 'text') {
    if (typeof x.content !== 'string' || !x.content.trim()) throw new Error('No readable timetable text. Upload a screenshot or export the document to PDF.')
    if (x.content.length > 100_000) throw new Error('Provide a smaller document; timetable text exceeds 100,000 characters.')
    return { type: 'text', content: x.content }
  }
  if (x.type !== 'images' || !Array.isArray(x.pages) || !x.pages.length) throw new Error('Select at least one page.')
  if (x.pages.length > 3) throw new Error('Select up to three pages per extraction.')
  let total = 0
  const pages = x.pages.map((v: unknown): PreparedImage => {
    if (!v || typeof v !== 'object') throw new Error('Invalid image source.')
    const p = v as Record<string, unknown>
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(p.mimeType)) || typeof p.data !== 'string' || !p.data.length || p.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) throw new Error('Invalid prepared image.')
    total += p.data.length * 3 / 4 - (p.data.endsWith('==') ? 2 : p.data.endsWith('=') ? 1 : 0)
    if (p.page !== undefined && (!Number.isInteger(p.page) || (p.page as number) < 1)) throw new Error('Invalid PDF page reference.')
    return { mimeType: p.mimeType as PreparedImage['mimeType'], data: p.data, ...(p.page !== undefined ? { page: p.page as number } : {}) }
  })
  if (total > MAX_SCHEDULE_IMAGES) throw new Error('Select fewer pages or provide a smaller image; prepared images exceed 3 MB.')
  return { type: 'images', pages }
}
