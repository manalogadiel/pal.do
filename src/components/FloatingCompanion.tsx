import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { CalEvent, PalId, PalState } from '../lib/core'
import { Pal } from '../pals/Pal'
import { Expand, Pause, Play, X, Mic, ChevronD } from './Icons'
import { active, isPaused, phaseLabel, remaining, running, type Session } from '../lib/session'
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

/** Content rendered inside the PiP OS window (or fallback in-app card) */
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
  // Drawer / modal toggle state (single-click toggles this Messenger-like controls drawer)
  const [drawerOpen, setDrawerOpen] = useState(true)

  // Single-click vs double-click differentiator
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSessionActive = active(session)
  const isSessionRunning = running(session)
  const isSessionPaused = isPaused(session)
  const timeStr = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const d = new Date(now)

  // Find upcoming event if any
  const upcoming = events.find((e) => e.start > now && e.status !== 'proposed' && e.kind !== 'deadline')

  const isListening = handsFree?.state === 'awake'
  const isMicActive = handsFree?.on && handsFree?.state !== 'off' && handsFree?.state !== 'error'

  const handleStageClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (clickTimer.current) {
      // Second click received within 280ms -> DOUBLE CLICK -> Open Full Web App!
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      onOpenApp()
    } else {
      // First click: wait briefly, if no second click -> SINGLE CLICK -> Toggle Modal Drawer & Poke
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        setDrawerOpen((prev) => !prev)
        onPoke()
      }, 260)
    }
  }

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[24px] bg-[var(--paper)] p-3 text-[var(--ink)] shadow-2xl select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-ink/[0.06] pb-2 px-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`size-2 rounded-full ${
              isListening
                ? 'bg-green-400 animate-ping'
                : isMicActive
                  ? 'bg-accent animate-pulse'
                  : 'bg-ink/30'
            }`}
            aria-hidden
          />
          <span className="truncate text-xs font-semibold tracking-tight text-ink">{palName}</span>
          <span className="text-[10px] text-ink-3">
            {isListening ? '· Listening…' : isMicActive ? '· Active' : '· Chronos'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenApp}
            className="press flex size-7 items-center justify-center rounded-full bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.1] hover:text-ink"
            title="Open Chronos full app (or double-click mascot)"
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

      {/* Mascot & Speech Stage (Click to toggle drawer, Double click to open full app) */}
      <div
        onClick={handleStageClick}
        className="relative flex flex-1 flex-col items-center justify-center py-1 cursor-pointer group"
        title="Click: toggle controls | Double-click: open full app"
      >
        {/* Listening / Active Aura */}
        {isListening && (
          <span
            className="absolute size-32 rounded-full animate-ping pointer-events-none"
            style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)', opacity: 0.35 }}
            aria-hidden
          />
        )}
        {isMicActive && !isListening && (
          <span
            className="absolute size-28 rounded-full ring-2 ring-accent/25 animate-pulse pointer-events-none"
            aria-hidden
          />
        )}

        <div
          className="stage relative flex flex-col items-center justify-center transition-transform duration-200 group-hover:scale-105"
          data-time={d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'night'}
        >
          <Pal id={pal} state={palState} size={drawerOpen ? 100 : 120} float className="relative z-10 pointer-events-none" />
          <span className="-mt-2 h-3 w-24 rounded-[50%] bg-ink/10 blur-[3px]" aria-hidden />

          {/* Green mic badge if awake */}
          {isListening && (
            <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-green-400 text-white shadow-md ring-2 ring-paper">
              <Mic className="size-3" />
            </span>
          )}
        </div>

        {/* Mascot Speech Bubble or Status Cue */}
        {bubble?.text ? (
          <div className="mt-1.5 max-w-[220px] rounded-2xl bg-paper-2 px-3 py-1.5 text-center text-xs leading-snug text-ink shadow-xs">
            {bubble.text.length > 70 ? `${bubble.text.slice(0, 68)}…` : bubble.text}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-ink-3 transition-colors group-hover:text-ink-2">
            {isListening
              ? 'Listening to you…'
              : handsFree?.on
                ? `Say "Hi ${palName}"`
                : 'Tap: controls · Double-tap: full app'}
          </p>
        )}
      </div>

      {/* Bottom Focus / Schedule Strip (Messenger-Style Controls Drawer) */}
      {drawerOpen ? (
        <div className="rounded-[18px] bg-paper-2/90 p-2.5 shadow-sm backdrop-blur-md transition-all">
          {/* Drawer header / collapse pill */}
          <div className="flex items-center justify-between pb-1 mb-1 border-b border-ink/[0.04]">
            <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
              {isSessionActive ? (isSessionPaused ? 'Paused' : phaseLabel(session)) : 'Focus Timer'}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setDrawerOpen(false)
              }}
              className="text-[10px] text-ink-3 hover:text-ink flex items-center gap-0.5"
              title="Minimize drawer"
            >
              <span>Hide</span>
              <ChevronD className="size-3" />
            </button>
          </div>

          {isSessionActive ? (
            <div className="flex items-center justify-between gap-2">
              <div className="tnum text-xl font-bold tracking-tight text-ink">
                {mmss(remaining(session, now))}
              </div>
              <div className="flex items-center gap-1.5">
                {isSessionRunning && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onPauseSession()
                    }}
                    className="press flex size-7 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                    aria-label="Pause timer"
                  >
                    <Pause className="size-3" />
                  </button>
                )}
                {isSessionPaused && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onResumeSession()
                    }}
                    className="press flex size-7 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                    aria-label="Resume timer"
                  >
                    <Play className="size-3 ml-0.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onStopSession()
                  }}
                  className="press h-7 rounded-full bg-ink/[0.08] px-2.5 text-xs font-medium text-ink hover:bg-ink/[0.12]"
                >
                  Stop
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-[10px] text-ink-3">Ambient</span>
                <div className="tnum text-xs font-semibold text-ink">{timeStr}</div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onStartPomodoro()
                }}
                className="press flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1.5 text-xs font-medium text-white shadow-xs hover-lift"
              >
                <Play className="size-3 fill-current" />
                <span>Start Pomodoro</span>
              </button>
            </div>
          )}

          {/* Upcoming Event Preview */}
          {!isSessionActive && upcoming && (
            <div className="mt-1.5 truncate border-t border-ink/[0.05] pt-1 text-[10px] text-ink-3">
              Next: <span className="font-medium text-ink-2">{upcoming.title}</span>
            </div>
          )}
        </div>
      ) : (
        /* Collapsed mini-bar: Click to expand drawer */
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="press flex w-full items-center justify-between rounded-full bg-paper-2/80 px-3 py-1.5 text-[11px] text-ink-2 hover:bg-paper-2 hover:text-ink shadow-xs"
        >
          <span className="truncate">
            {isSessionActive
              ? `${phaseLabel(session)} · ${mmss(remaining(session, now))}`
              : `Ambient · ${timeStr}`}
          </span>
          <span className="text-[10px] text-accent font-medium">Controls ↑</span>
        </button>
      )}
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
          width: 275,
          height: 385,
        })

        // Copy all parent stylesheets and style tags into pipWindow
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

        // Copy inline styles or font links in head
        document.querySelectorAll('link[rel="preconnect"], link[rel="stylesheet"]').forEach((el) => {
          pip.document.head.appendChild(el.cloneNode(true))
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

/** Floating Companion component that handles PiP portal or in-app floating fallback */
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
            try {
              window.focus()
            } catch {}
            onOpenApp()
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

  // 2. Render In-App Floating Fallback if enabled
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
            className="w-[275px] h-[385px] cursor-grab active:cursor-grabbing"
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
