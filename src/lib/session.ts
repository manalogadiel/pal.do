import * as legacy from './session-legacy'
export { FOCUS_MS, BREAK_MS, LONG_BREAK_MS, LONG_EVERY } from './session-legacy'
export type Method = 'pomodoro' | 'flowtime' | '52-17' | 'task' | 'custom'
export interface StudyConfig { method: Method; focusMinutes: number; breakMinutes: number; rounds: number; goal?: string; folderId?: string; folderName?: string; taskId?: string; preparation?: 'frog' }
export const DEFAULT_CONFIG: StudyConfig = { method: 'pomodoro', focusMinutes: 25, breakMinutes: 5, rounds: 4 }
export type Phase = 'idle' | 'ready' | 'focus' | 'break' | 'breakReady' | 'waiting' | 'finished'
export interface Session extends Omit<legacy.Session, 'phase'> {
  pendingDays?: Record<string, number>; focusDays?: Record<string, number>;
  phase: Phase; version?: 2; config?: StudyConfig; phaseStartedAt?: number; elapsedMs?: number; breakMs?: number; checkpointAt?: number; awayAt?: number; startedAt?: number; endedAt?: number; outcome?: 'done' | 'stopped'
}
export const IDLE: Session = legacy.IDLE
export const isPaused = (s: Session) => s.pausedLeft !== undefined
export const active = (s: Session) => ['focus', 'break', 'breakReady', 'waiting'].includes(s.phase)
export const running = (s: Session) => ['focus', 'break'].includes(s.phase) && !isPaused(s) && s.awayAt === undefined
export const countUp = (s: Session) => s.phase === 'focus' && ['flowtime', 'task'].includes(s.config?.method ?? '')
export function validateConfig(c: StudyConfig) {
  return !!c && ['pomodoro', 'flowtime', '52-17', 'task', 'custom'].includes(c.method) && Number.isInteger(c.focusMinutes) && c.focusMinutes >= (['flowtime', 'task'].includes(c.method) ? 0 : 1) && c.focusMinutes <= 180 && Number.isInteger(c.breakMinutes) && c.breakMinutes >= 0 && c.breakMinutes <= 60 && Number.isInteger(c.rounds) && c.rounds >= 1 && c.rounds <= 8 && (!['task'].includes(c.method) || !!c.goal?.trim()) && (!c.preparation || !!c.goal?.trim())
}
export function configure(config: StudyConfig): Session { return validateConfig(config) ? { ...IDLE, version: 2, phase: 'ready', config: { ...config } } : IDLE }
const duration = (c: StudyConfig) => (c.method === 'pomodoro' ? 25 : c.method === '52-17' ? 52 : c.focusMinutes) * 60_000
const rest = (s: Session) => (s.config?.method === 'pomodoro' ? s.round === 4 ? 15 : 5 : s.config?.method === '52-17' ? 17 : s.config?.breakMinutes ?? 0) * 60_000
const rounds = (s: Session) => s.config?.method === 'pomodoro' ? 4 : s.config?.method === '52-17' ? 1 : s.config?.rounds ?? 1
export function start(now: number, config: StudyConfig = DEFAULT_CONFIG): Session {
  if (!validateConfig(config)) return IDLE
  return { ...configure(config), phase: 'focus', phaseStartedAt: now, startedAt: now, checkpointAt: now, elapsedMs: 0, phaseEndsAt: now + duration(config) }
}
export function focusElapsed(s: Session, now: number): number {
  if (!s.version) return legacy.focusElapsed(s as legacy.Session, now)
  if (s.phase !== 'focus') return 0
  const elapsed = (s.elapsedMs ?? 0) + (isPaused(s) || s.awayAt !== undefined ? 0 : Math.max(0, now - (s.phaseStartedAt ?? now)))
  return countUp(s) ? elapsed : Math.min(duration(s.config!), elapsed)
}
export function remaining(s: Session, now: number): number {
  if (!s.version) return legacy.remaining(s as legacy.Session, now)
  if (countUp(s)) return focusElapsed(s, now)
  if (!['focus', 'break'].includes(s.phase)) return 0
  return isPaused(s) ? s.pausedLeft! : Math.min(s.phase === 'focus' ? duration(s.config!) : s.breakMs ?? rest(s), Math.max(0, s.phaseEndsAt - now))
}
function mergeDays(a: Record<string, number> = {}, b: Record<string, number> = {}) { const out = { ...a }; for (const [day, ms] of Object.entries(b)) out[day] = (out[day] ?? 0) + ms; return out }
function intervalDays(from: number, to: number) {
  const days: Record<string, number> = {}
  while (from < to) { const date = new Date(from); const end = Math.min(to, new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()); days[date.toDateString()] = (days[date.toDateString()] ?? 0) + end - from; from = end }
  return days
}
function focusedDays(s: Session, now: number) {
  if (s.phase !== 'focus') return {}
  const from = s.phaseStartedAt ?? now
  const available = countUp(s) ? Math.max(0, now - from) : Math.max(0, duration(s.config!) - (s.elapsedMs ?? 0))
  return mergeDays(s.pendingDays, isPaused(s) || s.awayAt !== undefined ? {} : intervalDays(from, Math.min(now, from + available)))
}
export function pause(s: Session, now: number): Session {
  if (!s.version) return legacy.pause(s as legacy.Session, now)
  if (!running(s)) return s
  return { ...s, pendingDays: focusedDays(s, now), elapsedMs: s.phase === 'focus' ? focusElapsed(s, now) : s.elapsedMs, pausedLeft: countUp(s) ? 0 : remaining(s, now), checkpointAt: now }
}
export function resume(s: Session, now: number): Session {
  if (!s.version) return legacy.resume(s as legacy.Session, now)
  if (!isPaused(s)) return s
  return { ...s, phaseStartedAt: now, phaseEndsAt: now + s.pausedLeft!, pausedLeft: undefined, checkpointAt: now }
}
export function finish(s: Session, now: number, done = false): Session {
  if (s.phase === 'finished' || s.phase === 'idle') return s
  return { ...s, focusDays: mergeDays(s.focusDays, s.version ? focusedDays(s, now) : {}), pendingDays: {}, phase: 'finished', completedFocusMs: s.completedFocusMs + focusElapsed(s, now), phaseEndsAt: 0, pausedLeft: undefined, awayAt: undefined, endedAt: now, outcome: done ? 'done' : 'stopped' }
}
function endBreak(s: Session, now: number): Session {
  return { ...s, phase: s.config?.method === 'flowtime' || s.round < rounds(s) ? 'waiting' : 'finished', phaseEndsAt: 0, pausedLeft: undefined, endedAt: now }
}
export function skip(s: Session, now: number): Session {
  if (!s.version) return legacy.skip(s as legacy.Session, now)
  if (s.phase === 'break') return endBreak(s, now)
  if (s.phase !== 'focus') return s
  const elapsed = focusElapsed(s, now), completedFocusMs = s.completedFocusMs + elapsed
  const credited = { ...s, focusDays: mergeDays(s.focusDays, focusedDays(s, now)), pendingDays: {} }
  if (s.config?.method === 'task') return finish(s, now)
  if (s.config?.method === 'flowtime') return { ...credited, phase: 'breakReady', completedFocusMs, breakMs: Math.max(5, Math.min(15, Math.ceil(elapsed / 300_000))) * 60_000, phaseEndsAt: 0, pausedLeft: undefined }
  const ms = rest(s)
  return ms ? { ...credited, phase: 'break', phaseStartedAt: now, phaseEndsAt: now + ms, completedFocusMs, pausedLeft: undefined } : endBreak({ ...credited, completedFocusMs }, now)
}
export function nextRound(s: Session, now: number, breakMinutes?: number): Session {
  if (s.phase === 'breakReady') {
    const ms = Math.max(1, Math.min(60, breakMinutes ?? (s.breakMs ?? 300_000) / 60_000)) * 60_000
    return { ...s, phase: 'break', phaseStartedAt: now, phaseEndsAt: now + ms, breakMs: ms, pausedLeft: undefined }
  }
  if (s.phase !== 'waiting') return s
  return { ...s, phase: 'focus', round: s.round + 1, pendingDays: {}, phaseStartedAt: now, elapsedMs: 0, phaseEndsAt: now + duration(s.config!), checkpointAt: now, endedAt: undefined }
}
export function tick(s: Session, now: number): Session {
  if (!s.version) return legacy.tick(s as legacy.Session, now)
  if (!running(s) || countUp(s) || now < s.phaseEndsAt) return s
  const next = s.phase === 'focus' ? skip(s, s.phaseEndsAt) : endBreak(s, s.phaseEndsAt)
  return next.phase === 'break' && now >= next.phaseEndsAt ? endBreak(next, next.phaseEndsAt) : next
}
export function checkpoint(s: Session, now: number): Session {
  if (!countUp(s) || !running(s)) return s
  return { ...s, pendingDays: focusedDays(s, now), elapsedMs: focusElapsed(s, now), phaseStartedAt: now, checkpointAt: now, awayAt: now }
}
export function recoverAway(s: Session, now: number, include: boolean): Session {
  if (s.awayAt === undefined) return s
  return { ...s, pendingDays: mergeDays(s.pendingDays, include ? intervalDays(s.awayAt, now) : {}), elapsedMs: (s.elapsedMs ?? 0) + (include ? Math.max(0, now - s.awayAt) : 0), phaseStartedAt: now, checkpointAt: now, awayAt: undefined }
}
export function phaseEnds(s: Session, now: number): { at: number; phase: 'focus' | 'break'; round: number }[] {
  if (!s.version) return legacy.phaseEnds(s as legacy.Session, now)
  if (!running(s) || countUp(s)) return []
  const out: { at: number; phase: 'focus' | 'break'; round: number }[] = []
  if (s.phaseEndsAt > now) out.push({ at: s.phaseEndsAt, phase: s.phase as 'focus' | 'break', round: s.round })
  if (s.phase === 'focus' && rest(s) && s.phaseEndsAt + rest(s) > now) out.push({ at: s.phaseEndsAt + rest(s), phase: 'break', round: s.round })
  return out
}
export function fromSaved(x: unknown): Session {
  const s = x as Session
  if (!s?.version) return legacy.fromSaved(x)
  if (s.version !== 2 || !validateConfig(s.config!) || !['idle', 'ready', 'focus', 'break', 'breakReady', 'waiting', 'finished'].includes(s.phase) || !Number.isInteger(s.round) || s.round < 1 || !Number.isFinite(s.phaseEndsAt) || !Number.isFinite(s.completedFocusMs) || s.completedFocusMs < 0) return IDLE
  for (const key of ['phaseStartedAt', 'elapsedMs', 'breakMs', 'checkpointAt', 'awayAt', 'startedAt', 'endedAt', 'pausedLeft'] as const) if (s[key] !== undefined && (!Number.isFinite(s[key]) || s[key]! < 0)) return IDLE
  for (const map of [s.pendingDays, s.focusDays]) if (map && (typeof map !== 'object' || Object.values(map).some(ms => !Number.isFinite(ms) || ms < 0))) return IDLE
  return s
}
export function phaseLabel(s: Session): string {
  if (!s.version) return legacy.phaseLabel(s as legacy.Session)
  return s.phase === 'focus' ? 'Focus' : s.phase === 'break' ? s.config?.method === 'pomodoro' && s.round === 4 ? 'Long break' : 'Break' : s.phase === 'waiting' ? 'Ready for the next round' : s.phase === 'breakReady' ? 'Choose your break' : s.phase === 'finished' ? 'Session finished' : ''
}
export const stop = (): Session => IDLE
