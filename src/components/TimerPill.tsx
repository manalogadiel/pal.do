import { useEffect, useState } from 'react'
import { fmtLeft, isPaused, timeLeft, type Timer } from '../lib/timers'
import { TimerIcon, X } from './Icons'

/** Voice timers, floating over every tab: the countdown, pause/resume, cancel, and "Stop" while it rings. */
export function TimerPill({ timers, ringing, onPause, onResume, onCancel, onStop }: {
  timers: Timer[]
  ringing: string | null
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onStop: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const counting = timers.some((t) => !t.done && !isPaused(t))
  useEffect(() => {
    if (!counting) return
    const i = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(i)
  }, [counting])
  const shown = timers.filter((t) => !t.done || t.id === ringing)
  if (!shown.length) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(10px,env(safe-area-inset-top))] z-[55] flex justify-center gap-2 px-4">
      {shown.map((t) => {
        const ring = t.id === ringing
        const paused = isPaused(t)
        const left = timeLeft(t, now)
        const warning = !paused && !ring && t.warnAt != null && now >= t.warnAt
        return (
          <div
            key={t.id}
            role="timer"
            aria-label={ring ? `${t.label}: time's up` : `${t.label}: ${fmtLeft(left)} left${paused ? ', paused' : ''}`}
            className={`pointer-events-auto pop flex h-10 items-center gap-2 rounded-full border pr-1.5 pl-3 text-[13px] shadow-[var(--edge)] backdrop-blur-xl ${
              ring ? 'flash border-tangerine/40 bg-tangerine text-white' : 'border-ink/[0.08] bg-paper/80 text-ink'
            }`}
          >
            <TimerIcon className={`size-4 shrink-0 ${ring ? '' : warning ? 'text-action-text' : 'text-ink-2'}`} />
            {ring ? (
              <>
                <span className="font-semibold">Time's up!</span>
                <button onClick={onStop} className="press h-7 rounded-full bg-white/20 px-3 text-[12.5px] font-semibold">Stop</button>
              </>
            ) : (
              <>
                <span className={`tnum min-w-[3.2em] font-semibold ${warning ? 'text-action-text' : ''} ${paused ? 'text-ink-3' : ''}`}>{fmtLeft(left)}</span>
                <button
                  onClick={() => (paused ? onResume(t.id) : onPause(t.id))}
                  className="press h-7 rounded-full px-2.5 text-[12px] font-medium text-ink-2 hover:bg-ink/[0.06] hover:text-ink"
                >
                  {paused ? 'Resume' : 'Pause'}
                </button>
                <button onClick={() => onCancel(t.id)} aria-label={`Cancel ${t.label}`} className="press grid size-7 place-items-center rounded-full text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
