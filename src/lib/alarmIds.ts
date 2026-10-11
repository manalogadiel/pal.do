// Native alarm helpers that need no Capacitor: notification ids and the scheduling policy. Pure, so they're testable.

/** Ids 900000+ are reserved for the Study tab; calendar alarms always stay below. */
const RESERVED_FROM = 900_000

/** First id of the Study tab's alarm block (kept for callers that need a single id). */
export const SESSION_ALARM_ID = 900001

/** One id per phase end in a set (4 focus ends + 4 break ends), with room to spare. */
export const SESSION_ALARM_IDS: readonly number[] = Array.from({ length: 10 }, (_, i) => SESSION_ALARM_ID + i)

/** Voice timers and reminders: warnings, ends and reminders. Their own block, after the Study tab's. */
export const TIMER_ALARM_IDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 910_001 + i)

export const isReservedAlarmId = (id: number) => id >= RESERVED_FROM

/** Stable id for a calendar event's alarm, always in 1..899999 (below the reserved range). */
export function eventAlarmId(eventId: string): number {
  let hash = 0
  for (let i = 0; i < eventId.length; i++) {
    hash = (hash << 5) - hash + eventId.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % 899_999) + 1
}

export type AlarmMode = 'off' | 'exact' | 'inexact'

/**
 * How to schedule without ever prompting. Capacitor's schedule() asks for notification permission and opens the
 * "Alarms & reminders" settings screen on its own, so: no notification permission → don't schedule at all;
 * exact alarms not granted → schedule inexact. Permission is only requested from an explicit "Turn on" tap.
 */
export function alarmMode(notificationsGranted: boolean, exactAlarm: string | undefined): AlarmMode {
  if (!notificationsGranted) return 'off'
  return exactAlarm === 'granted' ? 'exact' : 'inexact'
}

/**
 * Runs async ops one at a time, in call order, even when an earlier one fails. Native alarm calls are async,
 * so without this a quick Pause right after Start could finish before Start's arming and leave alarms set.
 */
export function makeSerial() {
  let last: Promise<void> = Promise.resolve()
  return (op: () => Promise<void>): Promise<void> => {
    last = last.then(op).catch(() => {}) // `last` never rejects, so a failed op can't block the next
    return last
  }
}
