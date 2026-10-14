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

/** Content rendered inside the PiP OS window (or fallback in-app card) with dynamic responsiveness */
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
  const containerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ w: 275, h: 385 })
  const [drawerOpen, setDrawerOpen] = useState(true)

  // Single vs double click detection
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Observe container dimensions in real-time as user resizes the PiP window
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setDims({ w: Math.round(width), h: Math.round(height) })
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const isSessionActive = active(session)
  const isSessionRunning = running(session)
  const isSessionPaused = isPaused(session)
  const timeStr = new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const d = new Date(now)

  // Find upcoming event if any
  const upcoming = events.find((e) => e.start > now && e.status !== 'proposed' && e.kind !== 'deadline')

  const isListening = handsFree?.state === 'awake'
  const isThinking = handsFree?.state === 'thinking'
  const isMicActive = handsFree?.on && handsFree?.state !== 'off' && handsFree?.state !== 'error'

  // Responsive mode flags
  const isLandscape = dims.w >= 265 && dims.h < 270
  const isCompactHeight = dims.h < 310
  const isTinyHeight = dims.h < 220

  // Dynamically calculate Pal size to guarantee zero overflow
  const availableVerticalForPal = dims.h - (drawerOpen ? 145 : 75)
  const dynamicPalSize = isLandscape
    ? Math.max(48, Math.min(95, dims.h - 75))
    : Math.max(48, Math.min(drawerOpen ? 110 : 135, Math.floor(availableVerticalForPal * 0.9)))

  const handleStageClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      onOpenApp()
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        setDrawerOpen((prev) => !prev)
        onPoke()
      }, 260)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[24px] bg-[var(--paper)] ${
        isCompactHeight ? 'p-2' : 'p-3'
      } text-[var(--ink)] shadow-2xl select-none`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-ink/[0.06] pb-1.5 px-0.5 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`size-2 shrink-0 rounded-full ${
              isListening
                ? 'bg-green-400 animate-ping'
                : isThinking
                  ? 'bg-amber-400 animate-pulse'
                  : isMicActive
                    ? 'bg-accent animate-pulse'
                    : 'bg-ink/30'
            }`}
            aria-hidden
          />
          <span className="truncate text-xs font-semibold tracking-tight text-ink">{palName}</span>
          <span className="truncate text-[10px] text-ink-3">
            {isListening ? '· Listening…' : isThinking ? '· Thinking…' : isMicActive ? '· Active' : '· Chronos'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenApp}
            className="press flex size-6.5 items-center justify-center rounded-full bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.1] hover:text-ink"
            title="Open Chronos full app (or double-click mascot)"
            aria-label="Open full app"
          >
            <Expand className="size-3" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="press flex size-6.5 items-center justify-center rounded-full bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.1] hover:text-ink"
            title="Close companion"
            aria-label="Close companion"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* Main Responsive Body */}
      {isLandscape ? (
        /* WIDE / SHORT (Landscape) LAYOUT: Side-by-side */
        <div className="flex flex-1 min-h-0 items-center justify-between gap-2.5 py-1">
          {/* Left: Mascot & aura */}
          <div
            onClick={handleStageClick}
            className="relative flex flex-col items-center justify-center shrink-0 cursor-pointer group px-1"
            title="Click: poke | Double-click: open full app"
          >
            {isListening && (
              <span
                className="absolute inset-0 rounded-full animate-ping pointer-events-none"
                style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)', opacity: 0.35 }}
                aria-hidden
              />
            )}
            <div
              className="stage relative flex flex-col items-center justify-center transition-transform group-hover:scale-105"
              data-time={d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'night'}
            >
              <Pal id={pal} state={palState} size={dynamicPalSize} float className="relative z-10 pointer-events-none" />
              <span className="-mt-1.5 h-2.5 w-16 rounded-[50%] bg-ink/10 blur-[2px]" aria-hidden />

              {isListening && (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-green-400 text-white shadow-md ring-1 ring-paper">
                  <Mic className="size-2.5" />
                </span>
              )}
            </div>
          </div>

          {/* Right: Controls & Timer */}
          <div className="flex-1 min-w-0 flex flex-col justify-center rounded-[16px] bg-paper-2/90 p-2 shadow-xs">
            {isSessionActive ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-accent truncate">
                    {isSessionPaused ? 'Paused' : phaseLabel(session)}
                  </span>
                  <span className="tnum text-base font-bold tracking-tight text-ink">
                    {mmss(remaining(session, now))}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isSessionRunning && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onPauseSession() }}
                      className="press flex size-6.5 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                      aria-label="Pause timer"
                    >
                      <Pause className="size-3" />
                    </button>
                  )}
                  {isSessionPaused && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onResumeSession() }}
                      className="press flex size-6.5 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                      aria-label="Resume timer"
                    >
                      <Play className="size-3 ml-0.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onStopSession() }}
                    className="press h-6.5 rounded-full bg-ink/[0.08] px-2 text-[11px] font-medium text-ink hover:bg-ink/[0.12]"
                  >
                    Stop
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-ink-3">Ambient</span>
                  <span className="tnum text-xs font-semibold text-ink">{timeStr}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onStartPomodoro() }}
                  className="press flex items-center justify-center gap-1 rounded-full bg-accent px-2 py-1 text-[11px] font-medium text-white shadow-xs hover-lift"
                >
                  <Play className="size-2.5 fill-current" />
                  <span>Pomodoro (25m)</span>
                </button>
              </div>
            )}
            {upcoming && (
              <div className="mt-1 truncate border-t border-ink/[0.05] pt-0.5 text-[9px] text-ink-3">
                Next: <span className="font-medium text-ink-2">{upcoming.title}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* VERTICAL / PORTRAIT LAYOUT: Stacked with flexible mascot stage */
        <>
          {/* Mascot Stage — flex-1 min-h-0 guarantees it shrinks and never pushes controls out of view */}
          <div
            onClick={handleStageClick}
            className="relative flex flex-1 min-h-0 flex-col items-center justify-center py-1 cursor-pointer group overflow-hidden"
            title="Click: toggle controls | Double-click: open full app"
          >
            {isListening && (
              <span
                className="absolute size-28 rounded-full animate-ping pointer-events-none"
                style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)', opacity: 0.35 }}
                aria-hidden
              />
            )}
            {isThinking && (
              <span
                className="absolute size-24 rounded-full ring-2 ring-amber-400/40 animate-pulse pointer-events-none"
                aria-hidden
              />
            )}
            {isMicActive && !isListening && !isThinking && (
              <span
                className="absolute size-24 rounded-full ring-2 ring-accent/25 animate-pulse pointer-events-none"
                aria-hidden
              />
            )}

            <div
              className="stage relative flex flex-col items-center justify-center transition-transform group-hover:scale-105 shrink-0"
              data-time={d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'night'}
            >
              <Pal id={pal} state={palState} size={dynamicPalSize} float className="relative z-10 pointer-events-none" />
              <span className="-mt-1.5 h-2.5 w-20 rounded-[50%] bg-ink/10 blur-[2px]" aria-hidden />

              {isListening && (
                <span className="absolute -top-1 -right-1 flex size-4.5 items-center justify-center rounded-full bg-green-400 text-white shadow-md ring-2 ring-paper">
                  <Mic className="size-2.5" />
                </span>
              )}
            </div>

            {/* Speech bubble or hint (hidden in tiny heights to conserve space) */}
            {!isTinyHeight && (
              bubble?.text ? (
                <div className="mt-1 max-w-[210px] rounded-2xl bg-paper-2 px-2.5 py-1 text-center text-[11px] leading-snug text-ink shadow-xs">
                  {bubble.text.length > 60 ? `${bubble.text.slice(0, 58)}…` : bubble.text}
                </div>
              ) : (
                <p className="mt-1 text-[10px] text-ink-3 transition-colors group-hover:text-ink-2 truncate max-w-[200px]">
                  {isListening
                    ? 'Listening to you…'
                    : isThinking
                      ? 'Thinking…'
                      : handsFree?.on
                        ? `Say "Hi ${palName}"`
                        : 'Tap: controls · Double-tap: full app'}
                </p>
              )
            )}
          </div>

          {/* Bottom Controls Drawer — shrink-0 so it is NEVER clipped */}
          <div className="shrink-0 pt-1">
            {drawerOpen ? (
              <div className={`rounded-[18px] bg-paper-2/90 ${isCompactHeight ? 'p-2' : 'p-2.5'} shadow-sm backdrop-blur-md`}>
                <div className="flex items-center justify-between pb-1 mb-1 border-b border-ink/[0.04]">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-ink-3 truncate">
                    {isSessionActive ? (isSessionPaused ? 'Paused' : phaseLabel(session)) : 'Focus Timer'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDrawerOpen(false) }}
                    className="text-[9px] text-ink-3 hover:text-ink flex items-center gap-0.5"
                    title="Minimize drawer"
                  >
                    <span>Hide</span>
                    <ChevronD className="size-2.5" />
                  </button>
                </div>

                {isSessionActive ? (
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="tnum text-lg font-bold tracking-tight text-ink">
                      {mmss(remaining(session, now))}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isSessionRunning && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onPauseSession() }}
                          className="press flex size-7 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                          aria-label="Pause timer"
                        >
                          <Pause className="size-3" />
                        </button>
                      )}
                      {isSessionPaused && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onResumeSession() }}
                          className="press flex size-7 items-center justify-center rounded-full bg-accent text-white shadow-xs"
                          aria-label="Resume timer"
                        >
                          <Play className="size-3 ml-0.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onStopSession() }}
                        className="press h-7 rounded-full bg-ink/[0.08] px-2.5 text-xs font-medium text-ink hover:bg-ink/[0.12]"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="min-w-0">
                      <span className="text-[9px] text-ink-3">Ambient</span>
                      <div className="tnum text-xs font-semibold text-ink">{timeStr}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onStartPomodoro() }}
                      className="press flex items-center gap-1 rounded-full bg-accent px-2.5 py-1.5 text-xs font-medium text-white shadow-xs hover-lift shrink-0"
                    >
                      <Play className="size-2.5 fill-current" />
                      <span>Start Pomodoro</span>
                    </button>
                  </div>
                )}

                {!isSessionActive && upcoming && !isCompactHeight && (
                  <div className="mt-1 truncate border-t border-ink/[0.05] pt-0.5 text-[9.5px] text-ink-3">
                    Next: <span className="font-medium text-ink-2">{upcoming.title}</span>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="press flex w-full items-center justify-between rounded-full bg-paper-2/80 px-2.5 py-1 text-[10.5px] text-ink-2 hover:bg-paper-2 hover:text-ink shadow-xs"
              >
                <span className="truncate">
                  {isSessionActive
                    ? `${phaseLabel(session)} · ${mmss(remaining(session, now))}`
                    : `Ambient · ${timeStr}`}
                </span>
                <span className="text-[9.5px] text-accent font-medium shrink-0 ml-1">Controls ↑</span>
              </button>
            )}
          </div>
        </>
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

        // Copy font links and preconnects
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
