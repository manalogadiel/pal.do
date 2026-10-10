import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { eventAlarmId, SESSION_ALARM_ID } from './alarmIds'
import type { CalEvent } from './core'

export const isNative = Capacitor.isNativePlatform()

/** Request local alarm and notification permissions */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNative) {
    try {
      const status = await LocalNotifications.requestPermissions()
      return status.display === 'granted'
    } catch (e) {
      console.warn('[notifications] Failed to request native permission', e)
      return false
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      const perm = await Notification.requestPermission()
      return perm === 'granted'
    } catch {
      return false
    }
  }

  return false
}

/** Check if notification permissions are currently granted */
export async function checkNotificationPermission(): Promise<boolean> {
  if (isNative) {
    try {
      const status = await LocalNotifications.checkPermissions()
      return status.display === 'granted'
    } catch {
      return false
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    return Notification.permission === 'granted'
  }

  return false
}

/** Sync all upcoming calendar events to native offline alarms */
export async function syncEventAlarms(events: CalEvent[], palName = 'Pal') {
  if (!isNative) return

  try {
    const hasPerm = await checkNotificationPermission()
    if (!hasPerm) return

    const now = Date.now()
    // Find future events that are planned
    const upcoming = events.filter(
      (e) => e.status === 'planned' && e.kind !== 'commute' && e.start > now
    )

    // Schedule reminders 10 minutes before start (or at start if less than 10 mins away)
    const notifications = upcoming.slice(0, 50).map((e) => {
      const alertTime = Math.max(now + 5000, e.start - 10 * 60 * 1000)
      return {
        id: eventAlarmId(e.id),
        title: `${palName}: ${e.title}`,
        body: `Starts at ${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Ready to begin?`,
        schedule: { at: new Date(alertTime) },
        sound: 'beep.wav',
        extra: { eventId: e.id },
      }
    })

    // Cancel pending calendar alarms and reschedule a clean set. Never touch the Study timer's alarm.
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications.filter((n) => n.id !== SESSION_ALARM_ID)
    if (stale.length > 0) {
      await LocalNotifications.cancel({
        notifications: stale.map((n) => ({ id: n.id })),
      })
    }

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications })
    }
  } catch (err) {
    console.warn('[notifications] Sync alarms failed:', err)
  }
}

/** Trigger an immediate or 5-second test alarm to verify device sound/alert */
export async function testAlarm(palName = 'Rei', delaySeconds = 5): Promise<boolean> {
  const granted = await requestNotificationPermission()
  if (!granted) return false

  const atTime = new Date(Date.now() + delaySeconds * 1000)

  if (isNative) {
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 99999,
            title: `${palName} (Alarm Test)`,
            body: `Ding! Your offline alarm is working properly!`,
            schedule: { at: atTime },
            sound: 'beep.wav',
          },
        ],
      })
      return true
    } catch (e) {
      console.warn('[notifications] Native test alarm failed', e)
      return false
    }
  }

  // Web fallback
  if (typeof window !== 'undefined' && 'Notification' in window) {
    setTimeout(() => {
      new Notification(`${palName} (Alarm Test)`, {
        body: 'Ding! Your browser notification is working properly!',
      })
    }, delaySeconds * 1000)
    return true
  }

  return false
}

/** Study tab: native alarm for the end of the current phase (one at a time). No-op on web. */
export async function scheduleSessionAlarm(at: number, title: string, body: string) {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: SESSION_ALARM_ID }] })
    await LocalNotifications.schedule({
      notifications: [{ id: SESSION_ALARM_ID, title, body, schedule: { at: new Date(at), allowWhileIdle: true }, sound: 'beep.wav' }],
    })
  } catch (err) {
    console.warn('[notifications] Session alarm failed:', err)
  }
}

export async function cancelSessionAlarm() {
  if (!isNative) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: SESSION_ALARM_ID }] })
  } catch (err) {
    console.warn('[notifications] Cancel session alarm failed:', err)
  }
}

/** Browser notification if already permitted. Never prompts, never throws. */
export function notifyWeb(title: string, body: string) {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
  } catch {}
}

/** Two short 880 Hz beeps via WebAudio; no asset needed. Never throws. */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    for (const offset of [0, 0.25]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset)
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime + offset + 0.16)
    }
    setTimeout(() => ctx.close().catch(() => {}), 800)
  } catch {}
}
