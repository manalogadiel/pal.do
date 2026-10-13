import { useEffect, useState } from 'react'
import type { PalId, PalState } from '../lib/core'
import { isPaused, LONG_EVERY, phaseLabel, remaining, FOCUS_MS, type Session } from '../lib/session'
import { Pal } from '../pals/Pal'
import Library, { type LibraryTarget } from './Library'
import type { Task } from '../lib/core'
import type { Folder, LibraryFile } from '../lib/library'

interface Props {
  session: Session
  pal: PalId
  palState: PalState
  todayMinutes: number
  /** The pal's latest line about the session, '' for none */
  palLine?: string
  alarmsOn: boolean
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onSkip: () => void
  onStop: () => void
  onEnableAlarms: () => void
  /** Library: reviewers and notes in folders */
  tasks: Task[]
  section: 'focus' | 'library'
  onSection: (s: 'focus' | 'library') => void
  libraryTarget?: LibraryTarget | null
  onLibraryTargetDone?: () => void
  onPlanFile: (file: LibraryFile, folder: Folder) => void
  onToast: (text: string) => void
  /** Desktop: the Focus/Library switch is in the panel's top bar, not here */
  tabsInHeader?: boolean
}

/** Focus / Library switch: inside Study on a phone, in the panel's top bar on a computer */
export function StudyTabs({ section, onSection }: { section: 'focus' | 'library'; onSection: (s: 'focus' | 'library') => void }) {
  return (
    <div className="inline-flex rounded-full bg-ink/[0.05] p-1" role="tablist" aria-label="Study">
      {(['focus', 'library'] as const).map((s) => (
        <button key={s} role="tab" aria-selected={section === s} type="button" onClick={() => onSection(s)} className={`press h-8 rounded-full px-4 text-[13px] ${section === s ? 'bg-paper font-medium shadow-sm' : 'text-ink-2'}`}>
          {s === 'focus' ? 'Focus' : 'Library'}
        </button>
      ))}
    </div>
  )
}

const mmss = (ms: number) => {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Study: the focus timer, and the library of reviewers. The session lives in App so switching tabs never stops it. */
export function Study(props: Props) {
  const { section, onSection } = props
  return (
    <div className="flex h-full flex-col">
      {!props.tabsInHeader && (
        <div className="flex shrink-0 justify-center px-4 pt-3">
          <StudyTabs section={section} onSection={onSection} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        {section === 'focus' ? <Focus {...props} /> : <Library pal={props.pal} tasks={props.tasks} now={Date.now()} target={props.libraryTarget} onTargetDone={props.onLibraryTargetDone} onPlan={props.onPlanFile} onToast={props.onToast} />}
      </div>
    </div>
  )
}

/** Pomodoro screen */
function Focus({ session, pal, palState, todayMinutes, palLine, alarmsOn, onStart, onPause, onResume, onSkip, onStop, onEnableAlarms }: Props) {
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
  const primary = 'press h-10 rounded-full bg-ink px-6 text-[14px] font-medium text-paper hover-lift'
  const secondary = 'press h-10 rounded-full px-5 text-[14px] text-ink-2 hover:bg-paper-3'

  return (
    // my-auto (not justify-center) so an overflowing column stays scrollable from the top on short phone screens
    <div className="flex h-full flex-col overflow-y-auto px-4 pt-6 pb-10">
      <div className="my-auto flex w-full max-w-[420px] flex-col items-center self-center">
        <div className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</div>
        <div className="tnum mt-3 text-[72px] font-bold leading-none tracking-[-0.04em] text-ink" role="timer" aria-live="off">{mmss(left)}</div>

        <div className="mt-4 flex gap-2" aria-label={`Round ${session.round} of ${LONG_EVERY}`}>
          {Array.from({ length: LONG_EVERY }, (_, i) => {
            const r = i + 1
            const done = !idle && r < session.round
            const current = !idle && r === session.round
            return <span key={r} className={`size-2 rounded-full ${done ? 'bg-tangerine' : current ? 'ring-2 ring-tangerine ring-offset-2 ring-offset-paper' : 'bg-ink/15'}`} />
          })}
        </div>

        {/* Controls sit right under the time so they stay above the fold on phones */}
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
          <button type="button" onClick={onEnableAlarms} className="press mt-3 rounded-full px-3 py-1 text-[12px] font-medium text-tangerine hover:bg-tangerine-soft">
            Enable completion chimes
          </button>
        )}

        <div className="mt-6 flex flex-col items-center">
          {palLine && (
            <p key={palLine} className="pop mb-2 max-w-[300px] rounded-2xl rounded-bl-[4px] bg-paper px-3.5 py-2 text-center text-[13px] leading-snug text-ink shadow-[var(--edge),0_8px_24px_-12px_rgb(35_37_56/0.2)]" aria-live="polite">
              {palLine}
            </p>
          )}
          <Pal id={pal} state={palState} size={110} />
        </div>

        <div className="mt-4 text-[12.5px] text-ink-3">Today: {todayMinutes}m focused</div>
      </div>
    </div>
  )
}

export default Study
