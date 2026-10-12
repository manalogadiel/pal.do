import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { alarmMode, eventAlarmId, isReservedAlarmId, makeSerial, SESSION_ALARM_IDS, TIMER_ALARM_IDS, type AlarmMode } from './alarmIds'
import { makeChime, type SoundName } from './chime'
import type { CalEvent } from './core'

export const isNative = Capacitor.isNativePlatform()

/**
 * Android 8+ takes a notification's sound from its channel, not from the notification. One channel for every
 * reminder, timer and round end, with Pal's own alert (android/app/src/main/res/raw/paldo_alert.wav).
 */
const CHANNEL = 'paldo-alerts'
const SOUND = 'paldo_alert.wav'
let channel: Promise<void> | null = null
function ensureChannel(): Promise<void> {
  if (!isNative || Capacitor.getPlatform() !== 'android') return Promise.resolve()
  return (channel ??= LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Reminders and timers',
    description: 'Event heads-ups, timers, reminders and study rounds',
    importance: 5,
    visibility: 1,
    sound: SOUND,
    vibration: true,
    lights: true,
  }).catch((e) => { channel = null; console.warn('[notifications] channel', e) }))
}
/** What every scheduled alarm shares: Pal's sound and channel */
const alert = { sound: SOUND, channelId: CHANNEL }

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
    // Never prompts: schedule() would otherwise open OS permission/settings screens on every calendar change
    const mode = await nativeAlarmMode()
    if (mode === 'off') return

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
        ...alert,
        isExactNotification: mode === 'exact',
        extra: { eventId: e.id },
      }
    })

    // Cancel pending calendar alarms and reschedule a clean set. Never touch the Study timer's alarms.
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications.filter((n) => !isReservedAlarmId(n.id))
    if (stale.length > 0) {
      await LocalNotifications.cancel({
        notifications: stale.map((n) => ({ id: n.id })),
      })
    }

    if (notifications.length > 0) {
      await ensureChannel()
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
      await ensureChannel()
      await LocalNotifications.schedule({
        notifications: [
          {
            id: 99999,
            title: `${palName} (Alarm Test)`,
            body: `Ding! Your offline alarm is working properly!`,
            schedule: { at: atTime },
            ...alert,
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

/** Current policy for native alarms, without ever prompting. */
async function nativeAlarmMode(): Promise<AlarmMode> {
  const notifications = await checkNotificationPermission()
  let exact: string | undefined
  try {
    exact = (await LocalNotifications.checkExactNotificationSetting()).exact_alarm
  } catch {}
  return alarmMode(notifications, exact)
}

/**
 * The only place the app may show OS permission screens, so call it only from an explicit "Turn on alarms" tap:
 * asks for notifications, then (Android 12+) sends the user to "Alarms & reminders" if exact alarms are off.
 */
export async function enableAlarms(): Promise<boolean> {
  const granted = await requestNotificationPermission()
  if (granted && isNative) {
    try {
      const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting()
      if (exact_alarm !== 'granted') await LocalNotifications.changeExactNotificationSetting()
    } catch {}
  }
  return granted
}


// One at a time, in call order, so the latest Start/Pause/Skip/Resume decides which alarms exist
const sessionOps = makeSerial()

async function cancelSessionAlarmsNow() {
  try {
    await LocalNotifications.cancel({ notifications: SESSION_ALARM_IDS.map((id) => ({ id })) })
  } catch (err) {
    console.warn('[notifications] Cancel session alarms failed:', err)
  }
}

/** Study tab: one native alarm per remaining phase end of the set, so they fire with the app in the background. */
export function scheduleSessionAlarms(alarms: { at: number; title: string; body: string }[]) {
  if (!isNative) return Promise.resolve()
  return sessionOps(() => armSessionAlarmsNow(alarms))
}

async function armSessionAlarmsNow(alarms: { at: number; title: string; body: string }[]) {
  try {
    await cancelSessionAlarmsNow()
    const mode = await nativeAlarmMode()
    if (mode === 'off' || alarms.length === 0) return
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: alarms.slice(0, SESSION_ALARM_IDS.length).map((a, i) => ({
        id: SESSION_ALARM_IDS[i],
        title: a.title,
        body: a.body,
        schedule: { at: new Date(a.at), allowWhileIdle: true },
        ...alert,
        isExactNotification: mode === 'exact',
      })),
    })
  } catch (err) {
    console.warn('[notifications] Session alarms failed:', err)
  }
}

export function cancelSessionAlarms() {
  if (!isNative) return Promise.resolve()
  return sessionOps(cancelSessionAlarmsNow)
}

// Voice timers and reminders: the same pattern as the Study alarms, in their own id block and queue
const timerOps = makeSerial()

/** Re-arm every timer warning/end and reminder still ahead, so they fire with the phone asleep */
export function scheduleTimerAlarms(alarms: { at: number; title: string; body: string }[]) {
  if (!isNative) return Promise.resolve()
  return timerOps(async () => {
    try {
      await LocalNotifications.cancel({ notifications: TIMER_ALARM_IDS.map((id) => ({ id })) })
      const mode = await nativeAlarmMode()
      if (mode === 'off' || alarms.length === 0) return
      await ensureChannel()
      await LocalNotifications.schedule({
        notifications: alarms.slice(0, TIMER_ALARM_IDS.length).map((a, i) => ({
          id: TIMER_ALARM_IDS[i],
          title: a.title,
          body: a.body,
          schedule: { at: new Date(a.at), allowWhileIdle: true },
          ...alert,
          isExactNotification: mode === 'exact',
        })),
      })
    } catch (err) {
      console.warn('[notifications] Timer alarms failed:', err)
    }
  })
}

/** Browser notification if already permitted. Never prompts, never throws. */
export function notifyWeb(title: string, body: string) {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body })
  } catch {}
}

const chime = makeChime(() =>
  typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext,
)
/** Call from a tap (Start/Resume/Skip) so the phase-end chime is allowed to sound later. */
export const unlockChime = () => chime.unlock()
/** The alarm melody; silent if the browser blocks audio or has none. Never throws. */
export const playChime = () => chime.play()

/** App sounds (send, reply, added…), unless switched off in Settings */
const SOUNDS_KEY = 'paldo.sounds'
export const soundsOn = () => { try { return localStorage.getItem(SOUNDS_KEY) !== 'off' } catch { return true } }
export const setSoundsOn = (on: boolean) => { try { localStorage.setItem(SOUNDS_KEY, on ? 'on' : 'off') } catch {} }
export const playSound = (name: SoundName) => { if (soundsOn()) chime.sound(name) }
