import { datedTasks, isTaskDone } from '../lib/tasks'
import { bestNextStep } from '../lib/next-step'
import { sayLength } from '../lib/timers'
import type { Prefs } from '../lib/schedule'
import { fmtDay, fmtHours, fmtTime, hoursOf, MIN, startOfDay, startOfWeek, type CalEvent, type Kind, type Task } from '../lib/core'
import { LoadStrip } from './Calendar'
import { Glyph } from './Icons'
import { Pal } from '../pals/Pal'
import type { PalId, PalState } from '../lib/core'

const TONE: Record<Kind, string> = {
  class: 'bg-[var(--ev-class)] text-[var(--ev-class-ink)] [--rule:var(--ev-class-rule)]',
  shift: 'bg-[var(--ev-shift)] text-[var(--ev-shift-ink)] [--rule:var(--ev-shift-rule)]',
  exam: 'bg-[var(--ev-exam)] text-[var(--ev-exam-ink)] [--rule:var(--ev-exam-rule)]',
  work: 'bg-accent-soft text-ink [--rule:var(--accent)]',
  commute: 'bg-[var(--ev-sand)] text-[var(--ev-sand-ink)] [--rule:var(--ev-sand-rule)]',
  protected: 'bg-[var(--ev-sage)] text-[var(--ev-sage-ink)] [--rule:var(--ev-sage-rule)]',
  deadline: 'bg-ink/[0.05] text-ink [--rule:var(--ink)]',
}

/** Progress ring. The stroke eases to its value so a check-off visibly fills it. */
export function Ring({ value, size = 40, label }: { value: number; size?: number; label?: string }) {
  const r = (size - 5) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v * 100)}% done`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-ink/[0.07]" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="4" strokeLinecap="round"
          className="ring-arc stroke-accent"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)}
        />
      </svg>
      <span className="tnum absolute text-[10.5px] font-semibold text-ink-2">{Math.round(v * 100)}</span>
    </div>
  )
}

function countdown(ms: number) {
  const m = Math.round(ms / MIN)
  if (m < 60) return `${Math.max(1, m)} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

interface Props {
  now: number
  events: CalEvent[]
  tasks: Task[]
  onOpen: (e: CalEvent, r: DOMRect) => void
  onPlan: (t: Task) => void
  onWeek: (dayIdx: number) => void
  onAddSchedule?:()=>void
  onTasks: () => void
  onStudy?: (section: 'focus' | 'library') => void
  pal: PalId
  palState: PalState
  onPoke: () => void
  onPrepare?: (task: Task, minutes: number) => void
  focusActive?: boolean
  prefs?: Prefs
}

export function Today({ now, events, tasks, onOpen, onPlan, onWeek, pal, palState, onPoke, onAddSchedule, onTasks, onStudy, onPrepare, focusActive, prefs }: Props) {
  const suggestion = !focusActive && onPrepare ? bestNextStep(now, events, tasks, prefs) : null
  const day = startOfDay(now)
  const todays = events
    .filter((e) => startOfDay(e.start) === day && e.kind !== 'deadline' && e.status !== 'proposed')
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
  const current = todays.find((e) => e.start <= now && e.end > now && (e.kind !== 'commute' || e.transportSource === 'user-trip'))
  const next = todays.find((e) => e.start > now && (e.kind !== 'commute' || e.transportSource === 'user-trip'))
  const left = todays.filter((e) => e.end > now)
  const hoursLeft = left.filter((e) => (e.kind !== 'commute' || e.transportSource === 'user-trip')).reduce((a, e) => a + hoursOf(e) - (e.start < now ? (now - e.start) / 3_600_000 : 0), 0)
  const deadlines = datedTasks(tasks).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id)).slice(0, 4)
  const upcoming = events.filter(e => e.start > now && startOfDay(e.start) > day && e.status !== 'proposed' && e.kind !== 'deadline').sort((a,b) => a.start - b.start)[0]
  const d = new Date(now)
  const ws = startOfWeek(now)

  let i = 0
  const st = () => ({ '--i': i++ } as React.CSSProperties)

  return (
    <div className="today-view h-full overflow-y-auto px-5 py-6 sm:px-6">
      <div className="today-layout">
      <header className="today-identity" style={st()}>
        <div className="today-stage stage relative flex w-full justify-center" data-time={d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'night'}>
          <div className="relative flex flex-col items-center">
            <Pal id={pal} state={palState} size={224} float onPoke={onPoke} className="today-pal relative z-10" />
            <span className="-mt-3 h-4 w-36 rounded-[50%] bg-ink/10 blur-[4px]" aria-hidden />
          </div>
        </div>
        <div className="today-date-block">
          <div className="today-weekday text-[13px] font-medium text-accent">{d.toLocaleDateString('en-US', { weekday: 'long' })}</div>
          <h1 className="today-date mt-1 font-serif tracking-[-0.025em]">
            {d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
          </h1>
        </div>
        <p className="today-summary mt-3 text-sm text-ink-2">
          {left.length
            ? <>{left.length} thing{left.length > 1 ? 's' : ''} left today · about <span className="tnum font-medium text-ink">{fmtHours(hoursLeft)}</span> booked</>
            : 'Nothing else booked today. The time is yours.'}
        </p>
      </header>

      <div className="min-w-0">
      <div className="today-shortcuts" aria-label="Shortcuts">{onAddSchedule&&<button onClick={onAddSchedule}>Add schedule</button>}<button onClick={onTasks}>Block Yard</button>{onStudy&&<><button onClick={()=>onStudy('focus')}>Pomodoro</button><button onClick={()=>onStudy('library')}>Folders</button></>}</div>
      {(current || next) && <div className="mb-4 flex flex-wrap gap-2" aria-label="Current and next event">
        {[current && { e: current, label: 'Now' }, next && { e: next, label: 'Next' }].filter(Boolean).map(x => { const { e, label } = x as { e: CalEvent; label: string }; return <button key={label} onClick={ev => onOpen(e, ev.currentTarget.getBoundingClientRect())} className="press min-h-11 rounded-[16px] bg-accent-soft px-4 py-2 text-left text-sm"><strong>{label}</strong> · {e.title}<span className="ml-2 text-ink-2">{fmtTime(e.start)}–{fmtTime(e.end)}</span></button> })}
      </div>}
      {/* Agenda */}
      <section>
        <h2 className="slide-in text-[22px] font-semibold tracking-[-0.015em]" style={st()}>Today</h2>
        {todays.length ? (
          <ol className="relative mt-3">
            <span className="absolute top-3 bottom-3 left-[59px] w-px bg-ink/[0.07]" aria-hidden />
            {todays.map((e) => {
              const past = e.end <= now
              const G = Glyph[e.kind]
              return (
                <li key={e.id} className="slide-in relative flex items-center gap-3 py-1" style={st()}>
                  <span className={`tnum w-[48px] shrink-0 text-right text-[12.5px] ${past ? 'text-ink-3' : 'text-ink-2'}`}>{fmtTime(e.start)}</span>
                  <span className={`relative z-10 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--paper)] ${past ? 'bg-ink/15' : e.start <= now ? 'bg-accent' : 'bg-ink/40'}`} />
                  <button
                    onClick={(ev) => onOpen(e, ev.currentTarget.getBoundingClientRect())}
                    className={`today-agenda-row press flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 py-2 text-left text-[14px] transition-opacity hover-lift ${TONE[e.kind]} `}
                  >
                    <G className="size-3.5 shrink-0 opacity-75" />
                    <span className="today-agenda-title min-w-0 break-words font-medium">{e.title}</span>
                    {e.note && <span className="hidden truncate text-[12px] opacity-70 sm:inline">· {e.note}</span>}
                    <span className="tnum ml-auto shrink-0 text-[12px]">{fmtTime(e.end)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="slide-in mt-2 text-[14.5px] text-ink-2" style={st()}>A clear day. Tell your pal about classes or shifts and they'll show up here.</p>
        )}
      </section>

      {suggestion && <section className="today-next-step mt-6" aria-labelledby="next-step-title">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">Best next step</span>
        <h3 id="next-step-title" className="mt-2 text-lg font-semibold leading-snug">{suggestion.next ? `You have ${sayLength(suggestion.availableMinutes * 60)} before ${suggestion.next.title}.` : `You have room for ${sayLength(suggestion.minutes * 60)} of focus.`}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">Spend {sayLength(suggestion.minutes * 60)} on <strong className="font-medium text-ink">{suggestion.task.title}</strong>.</p>
        <button className="tool-button-primary mt-4" onClick={() => onPrepare?.(suggestion.task, suggestion.minutes)}>Prepare focus session</button>
      </section>}

      {!todays.length && upcoming && <button onClick={ev => onOpen(upcoming, ev.currentTarget.getBoundingClientRect())} className="press mt-4 w-full rounded-[18px] bg-accent-soft p-4 text-left"><span className="text-sm text-ink-2">Next scheduled · {fmtDay(upcoming.start)} · {fmtTime(upcoming.start)}</span><strong className="mt-1 block">{upcoming.title}</strong></button>}
      </div>
      <div className="today-summaries">
      {/* Week glance */}
      <section className="slide-in mt-8" style={st()}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[22px] font-semibold tracking-[-0.015em]">This week</h2>
          <button onClick={() => onWeek((d.getDay() + 6) % 7)} className="press -mr-2 h-9 rounded-full px-3 text-[13px] font-medium text-ink-2 hover-lift hover:text-ink">Open week</button>
        </div>
        <div className="today-week-strip mt-3 rounded-[22px] bg-ink/[0.035] px-4 py-3.5">
          <LoadStrip weekStart={ws} events={events} active={(d.getDay() + 6) % 7} onPick={onWeek} />
        </div>
      </section>

      {/* Deadlines */}
      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-3"><h2 className="text-[20px] font-semibold">Coming up</h2><button onClick={onTasks} className="press h-11 rounded-full px-2 text-sm text-accent">View all tasks</button></div>
        {deadlines.length ? (
          <ul className="mt-3 space-y-1">
            {deadlines.map((t) => {
              const days = Math.round((startOfDay(t.due) - day) / 86_400_000)
              const planned = events.some((e) => e.taskId === t.id && e.kind === 'work' && e.status === 'planned' && e.start > now)
              return (
                <li key={t.id} className="today-deadline slide-in flex items-center gap-3.5 rounded-[20px] py-2" style={st()}>
                  <Ring value={t.hours > 0 ? t.doneHours / t.hours : 0} label={`${t.title}: ${fmtHours(t.doneHours)} of ${fmtHours(t.hours)} done`} />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[16px] font-medium">{t.title}</div>
                    <div className="text-[12.5px] text-ink-3">
                      <span className={days <= 2 ? 'font-medium text-amber' : ''}>{t.due < now ? 'Overdue' : days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDay(t.due).replace(/,.*/, '') + (days > 6 ? ` ${new Date(t.due).getDate()}` : '')}</span>
                      {t.hours>0&&<> · {fmtHours(Math.max(0, t.hours - t.doneHours))} left</>}
                    </div>
                  </div>
                  {!planned && t.hours - t.doneHours > 0.25 && (
                    <button onClick={() => onPlan(t)} className="press h-9 shrink-0 rounded-full bg-accent-soft px-3.5 text-[13px] font-medium text-ink">Plan it</button>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="slide-in mt-2 text-[14.5px] text-ink-2" style={st()}>No deadlines yet. Paste a syllabus to bring them all in at once.</p>
        )}
      </section>
      </div>
      </div>
    </div>
  )
}
