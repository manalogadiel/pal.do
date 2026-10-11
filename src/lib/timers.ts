// Voice timers and reminders as pure data. Like session.ts, everything is a timestamp, never a counted tick:
// a phone that slept through the end still finds out once it wakes, and fires each alert exactly once.

export interface Timer {
  id: string
  label: string
  endsAt: number
  /** "Remind me last 30 seconds": the heads-up time, before endsAt */
  warnAt?: number
  /** Ms left while paused; undefined = running */
  pausedLeft?: number
  warned?: boolean
  done?: boolean
}

export interface Reminder {
  id: string
  at: number
  text: string
  done?: boolean
}

export interface Alarms {
  timers: Timer[]
  reminders: Reminder[]
}

export const NO_ALARMS: Alarms = { timers: [], reminders: [] }
export const MAX_TIMERS = 3

export type Alert =
  | { kind: 'warn'; timer: Timer; leftMs: number }
  | { kind: 'done'; timer: Timer }
  | { kind: 'remind'; reminder: Reminder }

const uid = () => Math.random().toString(36).slice(2, 9)

/** A new timer. The warning only counts if it's shorter than the timer itself. Oldest is dropped past MAX_TIMERS. */
export function startTimer(a: Alarms, seconds: number, now: number, opts: { warnSeconds?: number; label?: string } = {}): Alarms {
  const endsAt = now + seconds * 1000
  const warn = opts.warnSeconds && opts.warnSeconds > 0 && opts.warnSeconds < seconds ? endsAt - opts.warnSeconds * 1000 : undefined
  const t: Timer = { id: uid(), label: opts.label?.trim() || 'Timer', endsAt, warnAt: warn }
  const live = a.timers.filter((x) => !x.done)
  return { ...a, timers: [...live, t].slice(-MAX_TIMERS) }
}

export function addReminder(a: Alarms, at: number, text: string): Alarms {
  return { ...a, reminders: [...a.reminders.filter((r) => !r.done), { id: uid(), at, text: text.trim() || 'Reminder' }] }
}

export const timeLeft = (t: Timer, now: number) => t.pausedLeft ?? Math.max(0, t.endsAt - now)
export const isPaused = (t: Timer) => t.pausedLeft !== undefined
/** The timer voice commands act on: the newest one still counting (or paused) */
export const newestTimer = (a: Alarms) => [...a.timers].reverse().find((t) => !t.done)

function update(a: Alarms, id: string, f: (t: Timer) => Timer): Alarms {
  return { ...a, timers: a.timers.map((t) => (t.id === id ? f(t) : t)) }
}

export const pauseTimer = (a: Alarms, id: string, now: number) =>
  update(a, id, (t) => (isPaused(t) || t.done ? t : { ...t, pausedLeft: Math.max(0, t.endsAt - now) }))

/** Resuming moves the end (and the warning with it) by however long it sat paused */
export const resumeTimer = (a: Alarms, id: string, now: number) =>
  update(a, id, (t) => {
    if (!isPaused(t)) return t
    const endsAt = now + (t.pausedLeft ?? 0)
    const shift = endsAt - t.endsAt
    return { ...t, endsAt, warnAt: t.warnAt == null ? undefined : t.warnAt + shift, pausedLeft: undefined }
  })

/** "Add 2 minutes". A warning that already went off can go off again if there's now time before it. */
export const addTime = (a: Alarms, id: string, seconds: number, now: number) =>
  update(a, id, (t) => {
    const ms = seconds * 1000
    if (isPaused(t)) return { ...t, pausedLeft: (t.pausedLeft ?? 0) + ms }
    const warnAt = t.warnAt == null ? undefined : t.warnAt + ms
    return { ...t, endsAt: t.endsAt + ms, warnAt, warned: t.warned && warnAt != null && warnAt <= now }
  })

export const cancelTimer = (a: Alarms, id: string): Alarms => ({ ...a, timers: a.timers.filter((t) => t.id !== id) })

/**
 * Everything that came due since the last check, each once, plus the state with those marked.
 * A timer whose end has passed skips its warning (no "30 seconds left" after time's up).
 */
export function tickAlarms(a: Alarms, now: number): { next: Alarms; alerts: Alert[] } {
  const alerts: Alert[] = []
  let changed = false
  const timers = a.timers.map((t) => {
    if (t.done || isPaused(t)) return t
    if (t.endsAt <= now) {
      changed = true
      const done = { ...t, done: true, warned: true }
      alerts.push({ kind: 'done', timer: done })
      return done
    }
    if (t.warnAt != null && !t.warned && t.warnAt <= now) {
      changed = true
      const warned = { ...t, warned: true }
      alerts.push({ kind: 'warn', timer: warned, leftMs: t.endsAt - now })
      return warned
    }
    return t
  })
  const reminders = a.reminders.map((r) => {
    if (r.done || r.at > now) return r
    changed = true
    const done = { ...r, done: true }
    alerts.push({ kind: 'remind', reminder: done })
    return done
  })
  if (!changed) return { next: a, alerts }
  // Finished ones stay one tick (for the "Time's up" pill) and are cleared by the caller; old reminders are dropped
  return { next: { timers, reminders: reminders.filter((r) => !r.done) }, alerts }
}

/** Native alarm list for a sleeping phone: every warning, end and reminder still ahead */
export function upcomingAlarms(a: Alarms, now: number): { at: number; kind: 'warn' | 'done' | 'remind'; label: string }[] {
  const out: { at: number; kind: 'warn' | 'done' | 'remind'; label: string }[] = []
  for (const t of a.timers) {
    if (t.done || isPaused(t)) continue
    if (t.warnAt != null && !t.warned && t.warnAt > now) out.push({ at: t.warnAt, kind: 'warn', label: t.label })
    if (t.endsAt > now) out.push({ at: t.endsAt, kind: 'done', label: t.label })
  }
  for (const r of a.reminders) if (!r.done && r.at > now) out.push({ at: r.at, kind: 'remind', label: r.text })
  return out.sort((x, y) => x.at - y.at)
}

/** 4:05, 0:30, 1:02:00 */
export function fmtLeft(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** "5 minutes", "30 seconds", "1 minute 30 seconds": how Pal says a length out loud */
export function sayLength(seconds: number) {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const part = (n: number, u: string) => (n ? `${n} ${u}${n === 1 ? '' : 's'}` : '')
  return [part(h, 'hour'), part(m, 'minute'), part(sec, 'second')].filter(Boolean).join(' ') || '0 seconds'
}
