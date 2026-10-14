import { deviceId } from './groq'
import { normalizeExtractedClasses } from './class-schedule'
import { MAX_SCHEDULE_REQUEST, validateScheduleSource, type ScheduleSource } from './schedule-source'

export async function extractClassSchedule(source: ScheduleSource, signal: AbortSignal) {
  if (!navigator.onLine) throw new Error('You are offline. Reconnect to extract the schedule, or enter classes manually.')
  const body = JSON.stringify(validateScheduleSource(source))
  if (new Blob([body]).size > MAX_SCHEDULE_REQUEST) throw new Error('Prepared request exceeds 4.5 MB. Select fewer pages.')
  const endpoint = import.meta.env.VITE_GROQ_PROXY_URL ? new URL('schedule-extract', new URL(import.meta.env.VITE_GROQ_PROXY_URL, location.href)).href : '/api/schedule-extract'
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pal-Device': deviceId() }, body, signal: controller.signal })
    let data
    try { data = await response.json() } catch (e) { if (controller.signal.aborted) throw e; throw new Error('Online extraction is unavailable. Retry or enter classes manually.') }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Online extraction failed. Retry or enter classes manually.')
    return normalizeExtractedClasses(data.classes)
  } catch (e) {
    if (timedOut) throw new Error('Extraction timed out. Retry with fewer pages or enter classes manually.')
    if (signal.aborted) throw e
    if (e instanceof TypeError) throw new Error('Cannot reach the online extraction service. Check your connection, retry, or enter classes manually.')
    throw e
  } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
}
