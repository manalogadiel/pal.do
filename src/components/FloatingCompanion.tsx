import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { CalEvent, PalId, PalState } from '../lib/core'
import { Pal } from '../pals/Pal'
import { Expand, Pause, Pip, Play, X, Mic } from './Icons'
import { active, isPaused, phaseLabel, remaining, running, type Session, type StudyConfig } from '../lib/session'
import type { HandsFreeState } from '../lib/handsfree'
import type { MascotBubble } from './Chat'

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>
      window?: Window | null
      onenter?: (event: Event) => void
    }
  }
}

interface FloatingCompanionProps {
  pal: PalId
  palName: string
  palState: PalState
  session: Session
  bubble: MascotBubble | null
  handsFree?: { on?: boolean; state: HandsFreeState; progress?: number; mic?: boolean; tap?: boolean; error?: string; heard?: string }
  events: CalEvent[]
  now: number
  onPoke: () => void
  onStartPomodoro: () => void
  onPauseSession: () => void
  onResumeSession: () => void
  onStopSession: () => void
  onOpenApp: () => void
}

const mmss = (ms: number) => {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Content rendered either inside the PiP OS window or inside the in-app draggable card */
export function CompanionCard({
  pal,
  palName,
  palState,
  session,
  bubble,
  handsFree,
  events,
  now,
  onPoke,
  onStartPomodoro,
  onPauseSession,
  onResumeSession,
  onStopSession,
  onOpenApp,
  onClose,
  isPip = false,
}: FloatingCompanionProps & { onClose: () => void; isPip?: boolean }) {
  const isSessionActive = active(session)
  const isSessionRunning = running(session)
  const isSessionPaused = isPaused(session)
  const timeStr = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const d = new Date(now)

  // Find upcoming event if any
  const upcoming = events.find((e) => e.start > now && e.status !== 'proposed' && e.kind !== 'deadline')

  return (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden rounded-[24px] bg-[var(--paper)] p-3.5 text-[var(--ink)] shadow-2xl select-none">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-ink/[0.06] pb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="size-2 rounded-full bg-accent animate-pulse" aria-hidden />
          <span className="truncate text-xs font-semibold tracking-tight text-ink">{palName}</span>
          <span className="text-[10px] text-ink-3">· Chronos</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenApp}
            className="press flex size-7 items-center justify-center rounded-full bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.1] hover:text-ink"
            title="Open Chronos full app"
            aria-label="Open full app"
          >
            <Expand className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="press flex size-7 items-center justify-center rounded-full bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.1] hover:text-ink"
            title="Close companion"
            aria-label="Close companion"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Mascot & Speech Stage */}
      <div className="relative flex flex-1 flex-col items-center justify-center py-2">
        <div
          className="stage relative flex flex-col items-center justify-center"
          data-time={d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'night'}
        >
          <Pal id={pal} state={palState} size={110} float onPoke={onPoke} className="relative z-10 cursor-pointer" />
          <span className="-mt-2 h-3 w-24 rounded-[50%] bg-ink/10 blur-[3px]" aria-hidden />
        </div>

        {/* Mascot Speech Bubble */}
        {bubble?.text ? (
          <div className="mt-1.5 max-w-[220px] rounded-2xl bg-paper-2 px-3 py-1.5 text-center text-xs leading-snug text-ink shadow-xs">
            {bubble.text.length > 70 ? `${bubble.text.slice(0, 68)}…` : bubble.text}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-ink-3">
            {handsFree?.state === 'awake'
              ? 'Listening to you…'
              : handsFree?.on
                ? `Say "Hi ${palName}"`
                : 'Tap to interact'}
          </p>
        )}
      </div>

      {/* Bottom Focus / Schedule Strip */}
      <div className="mt-1 rounded-[18px] bg-paper-2/80 p-2.5 backdrop-blur-md">
        {isSessionActive ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-accent">
                {isSessionPaused ? 'Paused' : phaseLabel(session)}
              </span>
              <div className="tnum text-xl font-bold tracking-tight text-ink">
                {mmss(remaining(session, now))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {isSessionRunning && (
                <button
                  type="button"
                  onClick={onPauseSession}
                  className="press flex size-8 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                  aria-label="Pause timer"
                >
                  <Pause className="size-3.5" />
                </button>
              )}
              {isSessionPaused && (
                <button
                  type="button"
                  onClick={onResumeSession}
                  className="press flex size-8 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                  aria-label="Resume timer"
                >
                  <Play className="size-3.5 ml-0.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onStopSession}
                className="press h-8 rounded-full bg-ink/[0.08] px-2.5 text-xs font-medium text-ink hover:bg-ink/[0.12]"
              >
                Stop
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] text-ink-3">Ambient Time</span>
              <div className="tnum text-sm font-semibold text-ink">{timeStr}</div>
            </div>
            <button
              type="button"
              onClick={onStartPomodoro}
              className="press flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-xs hover-lift"
            >
              <Play className="size-3 fill-current" />
              <span>Pomodoro (25m)</span>
            </button>
          </div>
        )}

        {/* Small schedule preview if idle */}
        {!isSessionActive && upcoming && (
          <div className="mt-1.5 truncate border-t border-ink/[0.05] pt-1 text-[10px] text-ink-3">
            Next: <span className="font-medium text-ink-2">{upcoming.title}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Hook for managing Document Picture-in-Picture window */
export function useFloatingCompanion() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [inAppFloating, setInAppFloating] = useState(false)
  const isSupported = typeof window !== 'undefined' && 'documentPictureInPicture' in window

  const openCompanion = useCallback(async () => {
    if (pipWindow) {
      pipWindow.focus()
      return
    }

    if (isSupported) {
      try {
        const pip = await window.documentPictureInPicture!.requestWindow({
          width: 270,
          height: 370,
        })

        // Copy all parent stylesheets into pipWindow
        Array.from(document.styleSheets).forEach((sheet) => {
          try {
            if (sheet.href) {
              const link = pip.document.createElement('link')
              link.rel = 'stylesheet'
              link.href = sheet.href
              pip.document.head.appendChild(link)
            } else if (sheet.cssRules) {
              const style = pip.document.createElement('style')
              Array.from(sheet.cssRules).forEach((rule) => {
                style.appendChild(pip.document.createTextNode(rule.cssText))
              })
              pip.document.head.appendChild(style)
            }
          } catch {
            if (sheet.href) {
              const link = pip.document.createElement('link')
              link.rel = 'stylesheet'
              link.href = sheet.href
              pip.document.head.appendChild(link)
            }
          }
        })

        // Match color scheme & root classes
        pip.document.documentElement.className = document.documentElement.className
        pip.document.body.className = `${document.body.className} m-0 p-0 overflow-hidden bg-[var(--canvas)]`
        pip.document.title = 'Chronos Companion'

        const container = pip.document.createElement('div')
        container.id = 'pip-companion-portal'
        container.className = 'h-screen w-screen p-2'
        pip.document.body.appendChild(container)

        pip.addEventListener('pagehide', () => {
          setPipWindow(null)
        })

        setPipWindow(pip)
        return
      } catch (err) {
        console.warn('PiP window failed to open, using in-app floating mode:', err)
      }
    }

    // Fallback: In-app draggable widget
    setInAppFloating(true)
  }, [isSupported, pipWindow])

  const closeCompanion = useCallback(() => {
    if (pipWindow) {
      pipWindow.close()
      setPipWindow(null)
    }
    setInAppFloating(false)
  }, [pipWindow])

  return {
    isSupported,
    pipWindow,
    inAppFloating,
    setInAppFloating,
    openCompanion,
    closeCompanion,
  }
}

/** Floating Companion component that handles PiP portal or in-app floating widget */
export function FloatingCompanionManager(props: FloatingCompanionProps & {
  pipWindow: Window | null
  inAppFloating: boolean
  onClose: () => void
  onOpenCompanion: () => void
}) {
  const { pipWindow, inAppFloating, onClose, onOpenApp } = props
  const [minimized, setMinimized] = useState(false)
  const [pos, setPos] = useState({ x: 20, y: 20 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })

  const handlePointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: pos.x,
      posY: pos.y,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = dragStart.current.x - e.clientX
    const dy = dragStart.current.y - e.clientY
    setPos({
      x: Math.max(10, Math.min(window.innerWidth - 80, dragStart.current.posX + dx)),
      y: Math.max(10, Math.min(window.innerHeight - 80, dragStart.current.posY + dy)),
    })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
  }

  // 1. Render in Native Document Picture-in-Picture window if active
  if (pipWindow) {
    const target = pipWindow.document.getElementById('pip-companion-portal')
    if (target) {
      return createPortal(
        <CompanionCard
          {...props}
          isPip
          onOpenApp={() => {
            window.focus()
            props.onOpenApp()
          }}
          onClose={() => {
            pipWindow.close()
            onClose()
          }}
        />,
        target
      )
    }
  }

  // 2. Render In-App Floating Widget if enabled
  if (inAppFloating) {
    return (
      <div
        style={{ right: `${pos.x}px`, bottom: `${pos.y}px` }}
        className="fixed z-50 transition-all select-none"
      >
        {minimized ? (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="press group relative flex size-14 cursor-grab items-center justify-center rounded-full bg-paper p-1 shadow-xl ring-2 ring-accent/30 active:cursor-grabbing hover-lift"
            onClick={() => setMinimized(false)}
            title="Expand Chronos Companion"
          >
            <Pal id={props.pal} state={props.palState} size={48} className="pointer-events-none" />
            <span className="absolute -top-1 -right-1 size-3 rounded-full bg-accent ring-2 ring-paper animate-pulse" />
          </div>
        ) : (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="w-[270px] h-[370px] cursor-grab active:cursor-grabbing"
          >
            <CompanionCard
              {...props}
              onClose={onClose}
            />
          </div>
        )}
      </div>
    )
  }

  return null
}

export default FloatingCompanionManager
