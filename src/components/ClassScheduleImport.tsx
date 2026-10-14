import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CLASS_TIMEZONE, defaultClassDateRange, normalizeExtractedClasses, reviewClassImport, rowIssues, type ClassDraft, type ClassRow } from '../lib/class-schedule'
import type { CalEvent } from '../lib/core'
import type { LibraryFile } from '../lib/library'
import { pdfScheduleInfo, preparePdfPages, prepareScheduleFile } from '../lib/schedule-files'
import { extractClassSchedule } from '../lib/schedule-client'
import type { ScheduleSource } from '../lib/schedule-source'
import { X } from './Icons'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export type ClassImportResult = { added: number; skipped: number }
export function conflictKey(conflicts: ReturnType<typeof reviewClassImport>['conflicts']) {
  // Expanded draft occurrences get fresh IDs on each check; compare the actual overlapping schedules.
  return JSON.stringify(conflicts.map(c => [c.incoming.title, c.incoming.start, c.incoming.end, c.existing.title, c.existing.start, c.existing.end]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
}
export function ClassReviewRows({ rows, onChange }: { rows: ClassRow[]; onChange: (rows: ClassRow[]) => void }) {
  const patch = (id: string, values: Partial<ClassRow>) => onChange(rows.map(row => row.id === id ? { ...row, ...values } : row))
  return <div className="class-review-rows">
    {!rows.length && <p className="text-ink-2">No weekly classes found. You can add rows manually.</p>}
    {rows.map((row, index) => {
      const issues = rowIssues(row)
      return <fieldset key={row.id} className="class-review-row">
        <legend className="font-semibold">Class {index + 1}</legend>
        <div className="flex items-center justify-between gap-3 mb-3">
          <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" checked={row.selected} disabled={issues.length > 0} onChange={e => patch(row.id, { selected: e.target.checked })} /> Include class {index + 1}</label>
          <button type="button" className="tool-button-secondary" aria-label={`Remove class ${index + 1}`} onClick={() => onChange(rows.filter(r => r.id !== row.id))}>Remove</button>
        </div>
        <label>Subject title<input value={row.title} maxLength={500} onChange={e => patch(row.id, { title: e.target.value })} /></label>
        <div className="mt-3"><span className="text-sm font-medium">Weekdays</span><div className="class-weekdays">{DAYS.map((day, d) => <label key={day}><input type="checkbox" aria-label={`${day} for class ${index + 1}`} checked={row.days.includes(d)} onChange={e => patch(row.id, { days: e.target.checked ? [...row.days, d].sort() : row.days.filter(n => n !== d) })} />{day}</label>)}</div></div>
        <div className="class-field-pair mt-3">
          <label>Start time<input type="time" value={row.startTime} onChange={e => patch(row.id, { startTime: e.target.value })} /></label>
          <label>End time<input type="time" value={row.endTime} onChange={e => patch(row.id, { endTime: e.target.value })} /></label>
          <label>Room<input value={row.room} maxLength={500} onChange={e => patch(row.id, { room: e.target.value })} /></label>
          <label>Instructor<input value={row.instructor} maxLength={500} onChange={e => patch(row.id, { instructor: e.target.value })} /></label>
        </div>
        {(row.sourceText || row.page) && <p className="mt-3 text-sm text-ink-2 whitespace-pre-wrap">{row.page ? `PDF page ${row.page} · ` : ''}{row.sourceText}</p>}
        {issues.length > 0 && <div className="mt-3 text-sm text-amber" role="status"><ul className="list-disc pl-5">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>{row.issues.length > 0 && <button type="button" className="tool-button-secondary mt-2" onClick={() => patch(row.id, { issues: [] })}>I checked and corrected this row</button>}</div>}
      </fieldset>
    })}
    <button type="button" className="tool-button-secondary mt-4" disabled={rows.length >= 64} onClick={() => onChange([...rows, ...normalizeExtractedClasses([{ title: '', days: [], startTime: null, endTime: null, issues: [] }])])}>Add class row</button>
  </div>
}

export default function ClassScheduleImport({ file, events, onCommit, onClose, onViewCalendar }: {
  file: LibraryFile; events: CalEvent[]; onCommit: (draft: ClassDraft, approval: string) => ClassImportResult
  onClose: () => void; onViewCalendar: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), run = useRef(0), controller = useRef<AbortController | null>(null), saving = useRef(false)
  const [stage, setStage] = useState<'prepare' | 'extracting' | 'review' | 'success'>('prepare')
  const [source, setSource] = useState<ScheduleSource | null>(null), [error, setError] = useState(''), [initializing, setInitializing] = useState(true)
  const [pages, setPages] = useState([1]), [pageCount, setPageCount] = useState(0), [previewPage, setPreviewPage] = useState(1), [pdfPreview, setPdfPreview] = useState(''), [imagePreview, setImagePreview] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [timezone] = useState(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || CLASS_TIMEZONE } catch { return CLASS_TIMEZONE } })
  const [classes, setClasses] = useState<ClassRow[]>([]), [dates, setDates] = useState(() => defaultClassDateRange(Date.now(), timezone)), [wasExtracted, setWasExtracted] = useState(false)
  const [dirty, setDirty] = useState(false), [approval, setApproval] = useState(''), [result, setResult] = useState<ClassImportResult | null>(null), [clock, setClock] = useState(Date.now())
  const draft: ClassDraft = { fileId: file.id, classes, ...dates, timezone }
  let review: ReturnType<typeof reviewClassImport> | null = null, validation = ''
  try { review = reviewClassImport(draft, events, clock) } catch (e) { validation = e instanceof Error ? e.message : 'Correct the selected classes.' }
  const currentConflicts = conflictKey(review?.conflicts ?? [])
  const overlapsApproved = !review?.conflicts.length || approval === currentConflicts
  const close = () => {
    if (saving.current && stage !== 'success') return
    if (dirty && stage !== 'success' && !window.confirm('Discard your edited class schedule?')) return
    ++run.current; controller.current?.abort(); onClose()
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, el = dialog.current
    el?.showModal()
    const timer = setInterval(() => setClock(Date.now()), 30_000)
    return () => { ++run.current; controller.current?.abort(); clearInterval(timer); el?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    let active = true
    if (file.kind === 'image') { const url = URL.createObjectURL(file.blob); setImagePreview(url); prepareScheduleFile(file).then(value => { if (active) setSource(value) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setInitializing(false) }); return () => { active = false; URL.revokeObjectURL(url) } }
    const prepare = file.kind === 'pdf' ? pdfScheduleInfo(file.blob).then(count => { if (active) setPageCount(count) }) : prepareScheduleFile(file).then(value => { if (active) setSource(value) })
    prepare.catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setInitializing(false) })
    return () => { active = false }
  }, [file])
  useEffect(() => {
    if (!pageCount) return
    let active = true; setPreviewBusy(true); setPdfPreview('')
    preparePdfPages(file.blob, [previewPage]).then(images => { if (active) setPdfPreview(`data:${images[0].mimeType};base64,${images[0].data}`) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setPreviewBusy(false) })
    return () => { active = false }
  }, [file, pageCount, previewPage])
  async function extract() {
    const token = ++run.current
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    setStage('extracting'); setError('')
    try {
      const prepared = file.kind === 'pdf' ? await prepareScheduleFile(file, pages) : source
      if (!prepared) throw new Error('This source is not readable. Retry preparation or enter classes manually.')
      if (token !== run.current) return
      setSource(prepared)
      const rows = await extractClassSchedule(prepared, abort.signal)
      if (token !== run.current || abort.signal.aborted) return
      setClasses(rows); setApproval(''); setDirty(false); setWasExtracted(true); setStage('review')
    } catch (e) {
      if (token !== run.current || abort.signal.aborted) return
      setError(e instanceof Error ? e.message : 'Online extraction failed. Retry or enter classes manually.'); setStage('prepare')
    }
  }
  const editRows = (rows: ClassRow[]) => { setClasses(rows.map(row => row.selected && rowIssues(row).length ? { ...row, selected: false } : row)); setDirty(true); setApproval(''); setError('') }
  const manual = () => { ++run.current; controller.current?.abort(); setClasses(normalizeExtractedClasses([{ title: '', days: [], issues: [] }])); setWasExtracted(false); setStage('review'); setDirty(false); setError('') }
  const confirm = () => {
    if (saving.current || stage !== 'review' || validation || (!review?.events.length && !review?.duplicates) || !overlapsApproved) return
    saving.current = true; setError('')
    try { setResult(onCommit(draft, approval)); setStage('success'); setDirty(false) }
    catch (e) { saving.current = false; setError(e instanceof Error ? e.message : 'Saving failed. Your review is still open; retry.'); setClock(Date.now()) }
  }
  return createPortal(<dialog ref={dialog} aria-labelledby="class-schedule-title" className="class-schedule-dialog liquid-solid text-ink" onCancel={e => { e.preventDefault(); close() }}>
    <header className="flex justify-between items-center gap-4"><div className="min-w-0"><h2 id="class-schedule-title" className="text-xl font-semibold">Review class schedule</h2><p className="text-sm text-ink-2 mt-1 break-words">{file.name}</p></div><button type="button" className="press size-11 shrink-0 grid place-items-center" onClick={close} aria-label="Close class schedule review"><X /></button></header>
    {stage === 'success' ? <div className="py-8"><h3 className="text-lg font-semibold">Classes added to Calendar</h3><p className="mt-2" role="status">{result?.added} added · {result?.skipped} duplicates skipped.</p><div className="flex flex-wrap gap-3 mt-5"><button className="tool-button-primary" onClick={onViewCalendar}>View calendar</button><button className="tool-button-secondary" onClick={() => { saving.current = false; setStage('prepare'); setClasses([]); setResult(null); setApproval('') }}>Extract another set of pages</button><button className="tool-button-secondary" onClick={() => { saving.current = false; close() }}>Done</button></div></div> : <>
      {stage === 'review' && <p className="mt-4 text-ink-2">{wasExtracted ? 'Na-extract ko ang schedule mo. Pakicheck kung tama ang subjects, days, at oras bago natin idagdag.' : 'Enter your classes, then check the subjects, days, and times before adding them.'}</p>}
      <div className="class-schedule-layout">
        <section className="class-source" aria-label="Source preview">
          <h3 className="font-semibold mb-3">Compare with your file</h3>
          {file.kind === 'pdf' && pageCount > 0 && <div className="mb-3">
            <label className="block text-sm">Preview PDF page<input className="class-page-input" type="number" min={1} max={pageCount} value={previewPage} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= pageCount) setPreviewPage(n) }} /></label><p className="text-sm text-ink-2">{pageCount} pages · choose up to three per extraction</p>
            {stage === 'prepare' && <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={pages.includes(previewPage)} disabled={!pages.includes(previewPage) && pages.length >= 3} onChange={e => setPages(e.target.checked ? [...pages, previewPage].sort((a, b) => a - b) : pages.filter(p => p !== previewPage))} />Include page {previewPage}</label>}
            <p className="text-sm">Selected pages: {pages.join(', ') || 'none'}</p>
          </div>}
          {(initializing || previewBusy) && <p role="status" className="text-ink-2">Preparing preview…</p>}
          {(pdfPreview || imagePreview) && <img className="class-source-image" src={pdfPreview || imagePreview} alt={file.kind === 'pdf' ? `Schedule source, PDF page ${previewPage}` : 'Uploaded class schedule'} />}
          {source?.type === 'text' && <pre className="class-source-text">{source.content}</pre>}
          {!initializing && !source && !pdfPreview && !imagePreview && <p className="text-ink-2">No readable preview. You can enter classes manually.</p>}
        </section>
        <section className="min-w-0">
          {stage === 'review' ? <>
            <ClassReviewRows rows={classes} onChange={editRows} />
            <div className="class-field-pair mt-6"><label>First date<input type="date" value={dates.startDate} onChange={e => { setDates({ ...dates, startDate: e.target.value }); setDirty(true); setApproval('') }} /></label><label>Last date<input type="date" value={dates.endDate} onChange={e => { setDates({ ...dates, endDate: e.target.value }); setDirty(true); setApproval('') }} /></label></div>
            <p className="mt-2 text-sm text-ink-2">{timezone} · default range: eight weeks. Past classes are excluded.</p>
            {validation && <p role="alert" className="mt-3 text-amber">{validation}</p>}
            {review && <p className="mt-4 font-semibold" aria-live="polite">{review.events.length} upcoming entries · {review.duplicates} duplicates skipped</p>}
            {!!review?.conflicts.length && <div className="class-overlaps"><h3 className="font-semibold">Overlapping schedules</h3><ul>{review.conflicts.slice(0, 12).map((c, i) => <li key={i}>{c.incoming.title} overlaps {c.existing.title} · {new Date(c.incoming.start).toLocaleString('en-PH', { timeZone: timezone })}</li>)}</ul>{review.conflicts.length > 12 && <p>And {review.conflicts.length - 12} more overlaps.</p>}<label className="flex items-center gap-2 min-h-11 mt-2"><input type="checkbox" checked={approval === currentConflicts} onChange={e => setApproval(e.target.checked ? currentConflicts : '')} />Add despite overlaps</label></div>}
          </> : <div className="py-4"><h3 className="font-semibold text-lg">Import your weekly classes</h3><p className="mt-2 text-ink-2">When you request extraction, the prepared pages or timetable text are sent to the online service. Nothing is added to Calendar until you review and confirm.</p><p className="mt-2 text-sm text-ink-2">For DOCX, only paragraphs and tables are read. Embedded images are ignored; export image-only schedules to PDF or upload a screenshot.</p><div className="flex flex-wrap gap-3 mt-5"><button className="tool-button-primary" disabled={initializing || stage === 'extracting' || (file.kind === 'pdf' ? !pages.length || !pageCount : !source)} onClick={() => void extract()}>{stage === 'extracting' ? 'Extracting…' : 'Extract class schedule'}</button><button className="tool-button-secondary" onClick={manual}>Enter classes manually</button></div>{stage === 'extracting' && <p role="status" className="mt-3 text-sm">Reading the selected source. You can cancel at any time.</p>}</div>}
        </section>
      </div>
      {error && <p role="alert" className="class-import-error">{error}</p>}
      <footer className="class-review-footer"><p className="text-sm text-ink-2">Only the review button can add classes. Chat or voice “yes” cannot confirm this import.</p><div className="flex flex-wrap gap-3">{stage === 'review' && <button className="tool-button-primary" disabled={!!validation || (!review?.events.length && !review?.duplicates) || !overlapsApproved} onClick={confirm}>Confirm and add selected classes</button>}<button className="tool-button-secondary" onClick={close}>Cancel</button></div></footer>
    </>}
  </dialog>, document.body)
}
