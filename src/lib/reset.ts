// "Reset app" in Settings: back to a fresh install. Everything this app saved on the device goes (calendar, chats,
// settings, the study library, the offline copy of the app) and it reloads into onboarding. Downloaded AI models stay:
// Ollama keeps its own, and the phone keeps its model file (re-checked, not re-copied).

/** Every IndexedDB database this app made (the study library), even on browsers without indexedDB.databases() */
async function databases(): Promise<string[]> {
  try {
    const list = await indexedDB.databases?.()
    if (list?.length) return list.map((d) => d.name).filter((n): n is string => !!n)
  } catch {}
  return ['paldo-library']
}

const drop = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })

export async function resetApp() {
  await Promise.all((await databases()).map(drop)).catch(() => {})
  if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k))).catch(() => {})
  if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister())).catch(() => {})
  // Last and synchronously before reloading, so nothing gets a chance to save the old state back
  try { localStorage.clear() } catch {}
  try { sessionStorage.clear() } catch {}
  location.reload()
}
