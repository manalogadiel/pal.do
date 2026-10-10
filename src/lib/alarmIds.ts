// Native notification ids. Pure so it's testable without Capacitor.

/** Reserved for the Study tab's phase-end alarm; calendar alarms never use it. */
export const SESSION_ALARM_ID = 900001

/** Stable id for a calendar event's alarm, always in 1..899999 (below the reserved range). */
export function eventAlarmId(eventId: string): number {
  let hash = 0
  for (let i = 0; i < eventId.length; i++) {
    hash = (hash << 5) - hash + eventId.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % 899_999) + 1
}
