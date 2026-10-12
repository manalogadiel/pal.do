import { Capacitor } from '@capacitor/core'

/** auto: the cloud when there's a network, this device when there isn't. online / offline: only that one. */
export type AiMode = 'auto' | 'online' | 'offline'
export const AI_MODE_EVENT = 'paldo-ai-mode-change'
const KEY = 'paldo.ai-mode'
/** The Android preview's two-way switch, before Auto existed */
const OLD_KEY = 'paldo.android.ai-mode'
export const isPhoneAiPlatform = () => Capacitor.getPlatform() === 'android'
export function getAiMode(): AiMode {
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)
    return v === 'online' || v === 'offline' ? v : 'auto'
  } catch {
    return 'auto'
  }
}
export function setAiMode(mode: AiMode): void {
  try {
    localStorage.setItem(KEY, mode)
    localStorage.removeItem(OLD_KEY)
  } catch {}
  window.dispatchEvent(new Event(AI_MODE_EVENT))
}
