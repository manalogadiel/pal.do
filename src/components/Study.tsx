import { useEffect, useState } from 'react'
import type { PalId, PalState } from '../lib/core'
import { isPaused, LONG_EVERY, phaseLabel, remaining, FOCUS_MS, type Session } from '../lib/session'
import { Pal } from '../pals/Pal'

interface Props {
  session: Session
  pal: PalId
  palState: PalState
  todayMinutes: number
  alarmsOn: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onSkip: () => void
  onStop: () => void
  onEnableAlarms: () => void
}

const mmss = (ms: number) => {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Pomodoro screen. Presentational: the session lives in App so switching tabs never stops it. */
export function Study({ session, pal, palState, todayMinutes, alarmsOn, onStart, onPause, onResume, onSkip, onStop, onEnableAlarms }: Props) {
  const running = session.phase !== 'idle' && !isPaused(session)
  // Display-only clock; correctness comes from the session's timestamps
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [running])

  const idle = session.phase === 'idle'
  const paused = isPaused(session)
  const left = idle ? FOCUS_MS : remaining(session, now)
  const label = idle ? 'Ready when you are' : paused ? `${phaseLabel(session)} · paused` : phaseLabel(session)
  const primary = 'press h-11 rounded-full bg-ink px-6 text-[15px] font-medium text-paper'
  const secondary = 'press h-11 rounded-full px-5 text-[15px] text-ink-2 hover:bg-paper-3'

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-6">
      <div className="flex w-full max-w-[420px] flex-col items-center">
        <div className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</div>
        <div className="tnum mt-2 text-[64px] font-semibold leading-none tracking-[-0.02em]" role="timer" aria-live="off">{mmss(left)}</div>

        <div className="mt-4 flex gap-2" aria-label={`Round ${session.round} of ${LONG_EVERY}`}>
          {Array.from({ length: LONG_EVERY }, (_, i) => {
            const r = i + 1
            const done = !idle && r < session.round
            const current = !idle && r === session.round
            return <span key={r} className={`size-2.5 rounded-full ${done ? 'bg-tangerine' : current ? 'ring-2 ring-tangerine ring-offset-2 ring-offset-paper' : 'bg-ink/15'}`} />
          })}
        </div>

        <div className="mt-6">
          <Pal id={pal} state={palState} size={120} />
        </div>

        <div className="mt-6 flex gap-2">
          {idle && <button type="button" onClick={onStart} className={primary}>Start</button>}
          {running && (
            <>
              <button type="button" onClick={onPause} className={primary}>Pause</button>
              <button type="button" onClick={onSkip} className={secondary}>Skip</button>
            </>
          )}
          {paused && (
            <>
              <button type="button" onClick={onResume} className={primary}>Resume</button>
              <button type="button" onClick={onStop} className={secondary}>Stop</button>
            </>
          )}
        </div>

        {!alarmsOn && (
          <button type="button" onClick={onEnableAlarms} className="press mt-4 rounded-full px-3 py-1.5 text-[13px] text-tangerine hover:bg-tangerine-soft">
            Turn on alarms so you hear when a round ends
          </button>
        )}

        <div className="mt-6 text-[13px] text-ink-3">Today: {todayMinutes} min focused</div>
      </div>
    </div>
  )
}

export default Study
