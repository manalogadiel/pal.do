import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
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

/** Convert string ID to a numeric ID for Capacitor LocalNotifications */
function hashId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
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
        id: hashId(e.id),
        title: `${palName}: ${e.title}`,
        body: `Starts at ${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Ready to begin?`,
        schedule: { at: new Date(alertTime) },
        sound: 'beep.wav',
        extra: { eventId: e.id },
      }
    })

    // Cancel existing pending notifications and reschedule clean set
    const pending = await LocalNotifications.getPending()
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
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
