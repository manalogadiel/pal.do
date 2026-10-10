// Pomodoro timer as pure data. Driven by timestamps, never by counting interval ticks:
// mobile WebViews freeze setInterval in the background, so a sleeping phone must still land in the right phase.

export type Phase = 'idle' | 'focus' | 'break'

export interface Session {
  phase: Phase
  /** 1-based focus round in the current cycle of LONG_EVERY */
  round: number
  /** Epoch ms when the current phase ends; meaningless when idle or paused */
  phaseEndsAt: number
  /** Ms left when paused; undefined = running */
  pausedLeft?: number
  /** Focus time finished in this session, for the daily log */
  completedFocusMs: number
}

export const FOCUS_MS = 25 * 60_000
export const BREAK_MS = 5 * 60_000
export const LONG_BREAK_MS = 15 * 60_000
export const LONG_EVERY = 4

export const IDLE: Session = { phase: 'idle', round: 1, phaseEndsAt: 0, completedFocusMs: 0 }

export const isPaused = (s: Session) => s.pausedLeft !== undefined

const breakLength = (round: number) => (round % LONG_EVERY === 0 ? LONG_BREAK_MS : BREAK_MS)

/** Move to the next phase, which starts at `at`. Focus time is credited by the caller. */
function advance(s: Session, at: number): Session {
  if (s.phase === 'focus') return { ...s, phase: 'break', phaseEndsAt: at + breakLength(s.round), pausedLeft: undefined }
  const round = s.round === LONG_EVERY ? 1 : s.round + 1
  return { ...s, phase: 'focus', round, phaseEndsAt: at + FOCUS_MS, pausedLeft: undefined }
}

export function start(now: number): Session {
  return { phase: 'focus', round: 1, phaseEndsAt: now + FOCUS_MS, completedFocusMs: 0 }
}

export function remaining(s: Session, now: number): number {
  if (s.phase === 'idle') return 0
  if (isPaused(s)) return s.pausedLeft!
  return Math.max(0, s.phaseEndsAt - now)
}

export function pause(s: Session, now: number): Session {
  if (s.phase === 'idle' || isPaused(s)) return s
  return { ...s, pausedLeft: remaining(s, now) }
}

export function resume(s: Session, now: number): Session {
  if (!isPaused(s)) return s
  return { ...s, phaseEndsAt: now + s.pausedLeft!, pausedLeft: undefined }
}

/** End the current phase now. A skipped focus only credits the time actually focused. */
export function skip(s: Session, now: number): Session {
  if (s.phase === 'idle') return s
  const credit = s.phase === 'focus' ? FOCUS_MS - remaining(s, now) : 0
  return advance({ ...s, completedFocusMs: s.completedFocusMs + credit }, now)
}

export function stop(): Session {
  return IDLE
}

/** Catch up to `now`. Natural phase ends chain from the previous end time, so long jumps land exactly. */
export function tick(s: Session, now: number): Session {
  let cur = s
  while (cur.phase !== 'idle' && !isPaused(cur) && now >= cur.phaseEndsAt) {
    const credit = cur.phase === 'focus' ? FOCUS_MS : 0
    cur = advance({ ...cur, completedFocusMs: cur.completedFocusMs + credit }, cur.phaseEndsAt)
  }
  return cur
}

/** Focus time spent in the current focus phase so far (0 outside focus). Used when stopping mid-round. */
export function focusElapsed(s: Session, now: number): number {
  return s.phase === 'focus' ? FOCUS_MS - remaining(s, now) : 0
}

/** Accept a session from storage only if it has the right shape; anything else is idle. */
export function fromSaved(x: unknown): Session {
  const s = x as Partial<Session> | null | undefined
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (!s || (s.phase !== 'idle' && s.phase !== 'focus' && s.phase !== 'break')) return IDLE
  if (!num(s.round) || s.round! < 1 || s.round! > LONG_EVERY || !num(s.phaseEndsAt) || !num(s.completedFocusMs)) return IDLE
  if (s.pausedLeft !== undefined && !num(s.pausedLeft)) return IDLE
  return { phase: s.phase, round: s.round!, phaseEndsAt: s.phaseEndsAt!, completedFocusMs: s.completedFocusMs!, ...(s.pausedLeft !== undefined ? { pausedLeft: s.pausedLeft } : {}) }
}

export function phaseLabel(s: Session): 'Focus' | 'Break' | 'Long break' | '' {
  if (s.phase === 'focus') return 'Focus'
  if (s.phase === 'break') return s.round % LONG_EVERY === 0 ? 'Long break' : 'Break'
  return ''
}
