/** Mammoth output is parsed in an inert document and reduced to text, never inserted into the page. */
export function docxHtmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,img,iframe,object').forEach(el => el.remove())
  doc.querySelectorAll('br').forEach(el => el.replaceWith('\n'))
  const blocks: string[] = []
  for (const el of Array.from(doc.body.children)) {
    if (el.tagName === 'TABLE') {
      const rows = Array.from(el.querySelectorAll('tr')).map(row => Array.from(row.children).map(cell => Array.from(cell.childNodes).map(node => node.textContent?.trim() ?? '').join('\n')).join('\t'))
      blocks.push(rows.join('\n'))
    } else blocks.push(el.textContent?.trim() ?? '')
  }
  return blocks.join('\n\n').trim()
}
export async function docxText(blob: Blob): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser')
  let text: string
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() }, { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) })
    text = docxHtmlToText(result.value)
  } catch { throw new Error('This DOCX cannot be read. It may be corrupted; export it to PDF or upload a screenshot.') }
  if (text.length > 100_000) throw new Error('Provide a smaller document; timetable text exceeds 100,000 characters.')
  return text
}
