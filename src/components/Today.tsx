import { fmtDay, fmtHours, fmtTime, hoursOf, MIN, startOfDay, startOfWeek, type CalEvent, type Kind, type Task } from '../lib/core'
import { LoadStrip } from './Calendar'
import { Glyph } from './Icons'
import { Pal } from '../pals/Pal'
import type { PalId, PalState } from '../lib/core'

const TONE: Record<Kind, string> = {
  class: 'bg-[var(--ev-class)] text-[var(--ev-class-ink)] [--rule:var(--ev-class-rule)]',
  shift: 'bg-[var(--ev-shift)] text-[var(--ev-shift-ink)] [--rule:var(--ev-shift-rule)]',
  exam: 'bg-[var(--ev-exam)] text-[var(--ev-exam-ink)] [--rule:var(--ev-exam-rule)]',
  work: 'bg-tangerine-soft text-ink [--rule:var(--tangerine)]',
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
          className="ring-arc stroke-tangerine"
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
  pal: PalId
  palName: string
  palState: PalState
  onPoke: () => void
  onTalk: () => void
}

export function Today({ now, events, tasks, onOpen, onPlan, onWeek, pal, palName, palState, onPoke, onTalk }: Props) {
  const day = startOfDay(now)
  const todays = events
    .filter((e) => startOfDay(e.start) === day && e.kind !== 'deadline' && e.status !== 'proposed')
    .sort((a, b) => a.start - b.start)
  const current = todays.find((e) => e.start <= now && e.end > now && e.kind !== 'commute')
  const next = todays.find((e) => e.start > now && e.kind !== 'commute')
  const left = todays.filter((e) => e.end > now)
  const hoursLeft = left.filter((e) => e.kind !== 'commute').reduce((a, e) => a + hoursOf(e) - (e.start < now ? (now - e.start) / 3_600_000 : 0), 0)
  const deadlines = tasks.filter((t) => t.due > now).sort((a, b) => a.due - b.due).slice(0, 4)
  const d = new Date(now)
  const ws = startOfWeek(now)

  let i = 0
  const st = () => ({ '--i': i++ } as React.CSSProperties)

  return (
    <div className="mx-auto h-full max-w-[680px] overflow-y-auto overscroll-contain px-6 pt-5 pb-10 sm:px-8 min-[900px]:pt-[72px]">
      {/* Mascot hero: the pal stands centre stage, date beneath */}
      <header className="slide-in flex flex-col items-center text-center" style={st()}>
        <div className="stage relative flex w-full justify-center pt-2 min-[900px]:pt-8" data-time={d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'night'}>
          <div className="relative flex flex-col items-center">
            <Pal id={pal} state={palState} size={220} float onPoke={onPoke} className="relative z-10" />
            <span className="-mt-3 h-4 w-36 rounded-[50%] bg-ink/10 blur-[4px]" aria-hidden />
          </div>
        </div>
        <button onClick={onTalk} className="press mt-3 min-[900px]:mt-2 h-9 rounded-full bg-ink/[0.05] px-4 text-[13px] font-medium text-ink-2 hover-lift hover:text-ink">Talk to {palName}</button>
        <div className="mt-6 min-[900px]:mt-4 text-[13px] font-medium text-tangerine">{d.toLocaleDateString('en-US', { weekday: 'long' })}</div>
        <h1 className="mt-0.5 font-serif text-[56px] leading-[0.95] tracking-[-0.025em]">
          {d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
        </h1>
        <p className="mt-2.5 text-[14.5px] text-ink-2">
          {left.length
            ? <>{left.length} thing{left.length > 1 ? 's' : ''} left today · about <span className="tnum font-medium text-ink">{fmtHours(hoursLeft)}</span> booked</>
            : 'Nothing else booked today. The evening is yours.'}
        </p>
      </header>

      {/* Now / Next */}
      {(current || next) && (
        <section className="mt-7 min-[900px]:mt-5 grid gap-2.5 sm:grid-cols-2">
          {[current && { e: current, tag: 'Now', sub: `${countdown(current.end - now)} left` }, next && { e: next, tag: 'Next', sub: `in ${countdown(next.start - now)}` }]
            .filter(Boolean)
            .map((x) => {
              const { e, tag, sub } = x as { e: CalEvent; tag: string; sub: string }
              const G = Glyph[e.kind]
              return (
                <button
                  key={e.id}
                  onClick={(ev) => onOpen(e, ev.currentTarget.getBoundingClientRect())}
                  style={st()}
                  className={`slide-in press relative overflow-hidden rounded-[24px] p-4 pl-5 text-left hover-lift ${TONE[e.kind]}`}
                >
                  <div className="flex items-center gap-2 text-[11.5px] font-semibold tracking-[0.04em] uppercase opacity-80">
                    {tag === 'Now' && <span className="pulse-dot size-1.5 rounded-full bg-[var(--rule)]" />}
                    {tag}
                    <span className="tnum ml-auto font-medium tracking-normal normal-case">{sub}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <G className="size-4 shrink-0 opacity-80" />
                    <span className="truncate text-[19px] leading-tight font-semibold tracking-[-0.01em]">{e.title}</span>
                  </div>
                  <div className="tnum mt-1 text-[13px] opacity-75">{fmtTime(e.start)} – {fmtTime(e.end)}</div>
                  {tag === 'Now' && (
                    <div className="relative mt-3 h-1 overflow-hidden rounded-full">
                      <div className="absolute inset-0 bg-[var(--rule)] opacity-20" />
                      <div className="relative h-full rounded-full bg-[var(--rule)] transition-[width] duration-700" style={{ width: `${((now - e.start) / (e.end - e.start)) * 100}%` }} />
                    </div>
                  )}
                </button>
              )
            })}
        </section>
      )}

      {/* Agenda */}
      <section className="mt-8">
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
                  <span className={`relative z-10 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--paper)] ${past ? 'bg-ink/15' : e.start <= now ? 'bg-tangerine' : 'bg-ink/40'}`} />
                  <button
                    onClick={(ev) => onOpen(e, ev.currentTarget.getBoundingClientRect())}
                    className={`press flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4 py-2 text-left text-[14px] transition-opacity hover-lift ${TONE[e.kind]} ${past ? 'opacity-45' : ''}`}
                  >
                    <G className="size-3.5 shrink-0 opacity-75" />
                    <span className="truncate font-medium">{e.title}</span>
                    {e.note && <span className="hidden truncate text-[12px] opacity-70 sm:inline">· {e.note}</span>}
                    <span className="tnum ml-auto shrink-0 text-[12px] opacity-65">{fmtHours(hoursOf(e))}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="slide-in mt-2 text-[14.5px] text-ink-2" style={st()}>A clear day. Tell your pal about classes or shifts and they'll show up here.</p>
        )}
      </section>

      {/* Week glance */}
      <section className="slide-in mt-8" style={st()}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[22px] font-semibold tracking-[-0.015em]">This week</h2>
          <button onClick={() => onWeek((d.getDay() + 6) % 7)} className="press -mr-2 h-9 rounded-full px-3 text-[13px] font-medium text-ink-2 hover-lift hover:text-ink">Open week</button>
        </div>
        <div className="mt-3 rounded-[22px] bg-ink/[0.035] px-4 py-3.5">
          <LoadStrip weekStart={ws} events={events} active={(d.getDay() + 6) % 7} onPick={onWeek} />
        </div>
      </section>

      {/* Deadlines */}
      <section className="mt-8">
        <h2 className="slide-in text-[22px] font-semibold tracking-[-0.015em]" style={st()}>Coming up</h2>
        {deadlines.length ? (
          <ul className="mt-3 space-y-1">
            {deadlines.map((t) => {
              const days = Math.round((startOfDay(t.due) - day) / 86_400_000)
              const planned = events.some((e) => e.taskId === t.id && e.kind === 'work' && e.status === 'planned' && e.start > now)
              return (
                <li key={t.id} className="slide-in flex items-center gap-3.5 rounded-[20px] py-2" style={st()}>
                  <Ring value={t.doneHours / t.hours} label={`${t.title}: ${fmtHours(t.doneHours)} of ${fmtHours(t.hours)} done`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-medium">{t.title}</div>
                    <div className="text-[12.5px] text-ink-3">
                      <span className={days <= 2 ? 'font-medium text-amber' : ''}>{days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDay(t.due).replace(/,.*/, '') + (days > 6 ? ` ${new Date(t.due).getDate()}` : '')}</span>
                      {' · '}{fmtHours(Math.max(0, t.hours - t.doneHours))} left
                    </div>
                  </div>
                  {!planned && t.hours - t.doneHours > 0.25 && (
                    <button onClick={() => onPlan(t)} className="press h-9 shrink-0 rounded-full bg-tangerine-soft px-3.5 text-[13px] font-medium text-ink">Plan it</button>
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
  )
}
