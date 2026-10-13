import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Offline support for the deployed app only. On the dev server the worker served the browser's saved copy of every
// source file first, so edits didn't show (and mixed old and new code); there it removes itself and its cache.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[PWA] Service worker registration failed:', err))
    })
  } else {
    void navigator.serviceWorker.getRegistrations().then(async (regs) => {
      if (!regs.length) return
      await Promise.all(regs.map((r) => r.unregister()))
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
      location.reload() // this load came from the old cache: load the real files once
    })
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
