import { fmtDay, fmtHours, fmtTime, startOfDay, type CalEvent, type Task } from '../lib/core'
import { Glyph } from './Icons'
import { Ring } from './Today'

interface Props {
  now: number
  tasks: Task[]
  events: CalEvent[]
  onPlan: (t: Task) => void
  onAdd: (text: string) => void
}

export function Tasks({ now, tasks, events, onPlan, onAdd }: Props) {
  const open = tasks.filter((t) => t.due > now && t.doneHours < t.hours).sort((a, b) => a.due - b.due)
  const done = tasks.filter((t) => t.doneHours >= t.hours)
  const past = tasks.filter((t) => t.due <= now && t.doneHours < t.hours)
  let i = 0
  const st = () => ({ '--i': i++ } as React.CSSProperties)

  const Row = ({ t }: { t: Task }) => {
    const blocks = events.filter((e) => e.taskId === t.id && e.kind === 'work' && e.status === 'planned' && e.start > now).sort((a, b) => a.start - b.start)
    const days = Math.round((startOfDay(t.due) - startOfDay(now)) / 86_400_000)
    const remaining = Math.max(0, t.hours - t.doneHours)
    const G = Glyph[t.kind === 'exam' ? 'exam' : 'work']
    return (
      <li className="slide-in flex items-center gap-4 rounded-2xl px-4 py-3 transition-colors hover:bg-ink/[0.03]" style={st()}>
        <Ring value={t.doneHours / t.hours} size={42} label={`${fmtHours(t.doneHours)} of ${fmtHours(t.hours)} done`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <G className="size-3.5 shrink-0 text-ink-3" />
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{t.title}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-ink-2">
            <span className={days <= 2 && days >= 0 ? 'font-medium text-amber' : ''}>
              {days < 0 ? 'Past due' : days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due ${fmtDay(t.due)}`}
            </span>
            {' · '}{remaining > 0 ? `${fmtHours(remaining)} left` : 'all done'}
          </div>
          {blocks[0] && <div className="tnum mt-0.5 text-[12px] text-ink-3">Next block {fmtDay(blocks[0].start).replace(/,.*/, '')} {fmtTime(blocks[0].start)} · {blocks.length} planned</div>}
        </div>
        {remaining > 0.25 && !blocks.length && (
          <button onClick={() => onPlan(t)} className="press h-9 shrink-0 rounded-full bg-tangerine px-4 text-[13px] font-medium text-white shadow-[0_4px_12px_-6px_var(--tangerine)]">Plan</button>
        )}
        {remaining > 0.25 && blocks.length > 0 && (
          <button onClick={() => onPlan(t)} className="press h-9 shrink-0 rounded-full px-3 text-[12.5px] font-medium text-ink-2 hover-lift hover:text-ink">Re-plan</button>
        )}
      </li>
    )
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-4 pt-6 pb-10 sm:px-8">
      <header className="slide-in px-2" style={st()}>
        <h1 className="font-sans text-[32px] font-bold leading-tight tracking-tight text-ink">Tasks</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">Exams and deliverables</p>
      </header>

      <div className="slide-in mt-5 flex flex-wrap gap-2 px-2" style={st()}>
        {['Math quiz next Tuesday', 'History essay due Friday', 'Paste my syllabus'].map((c) => (
          <button key={c} onClick={() => onAdd(c)} className="press h-9 rounded-full bg-ink/[0.05] px-4 text-[13.5px] text-ink-2 hover-lift hover:text-ink">+ {c}</button>
        ))}
      </div>

      {open.length ? (
        <ul className="mt-5 space-y-0.5">{open.map((t) => <Row key={t.id} t={t} />)}</ul>
      ) : (
        <p className="slide-in mt-6 px-2 text-[14.5px] text-ink-2" style={st()}>Nothing open. Tell your pal about an exam or assignment to start.</p>
      )}

      {past.length > 0 && (
        <>
          <h2 className="slide-in mt-8 px-2 text-[13px] font-medium text-ink-3" style={st()}>Past due</h2>
          <ul className="mt-1 space-y-0.5 opacity-70">{past.map((t) => <Row key={t.id} t={t} />)}</ul>
        </>
      )}
      {done.length > 0 && (
        <>
          <h2 className="slide-in mt-8 px-2 text-[13px] font-medium text-ink-3" style={st()}>Done</h2>
          <ul className="mt-1 space-y-0.5 opacity-60">{done.map((t) => <Row key={t.id} t={t} />)}</ul>
        </>
      )}
    </div>
  )
}
