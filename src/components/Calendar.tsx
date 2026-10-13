import { useEffect, useRef } from 'react'
import { addDays, at, fmtTime, HOUR, hoursOf, startOfDay, type CalEvent, type Kind, type PalId } from '../lib/core'
import { Pal } from '../pals/Pal'
import { Check, Glyph } from './Icons'

/** Grid starts at 6am, or earlier when something starts before then (a 4am ride to school) */
const EARLIEST = 6
const H1 = 24
const PX = 56

const KIND: Record<Kind, string> = {
  class: 'bg-[var(--ev-class)] [--rule:var(--ev-class-rule)] text-[var(--ev-class-ink)]',
  shift: 'bg-[var(--ev-shift)] [--rule:var(--ev-shift-rule)] text-[var(--ev-shift-ink)]',
  exam: 'bg-[var(--ev-exam)] [--rule:var(--ev-exam-rule)] text-[var(--ev-exam-ink)]',
  work: 'bg-paper/90 [--rule:var(--tangerine)] text-ink shadow-[0_2px_10px_-4px_rgb(60_44_30/0.18)]',
  commute: 'stripes [--rule:var(--ev-sand-rule)] text-[var(--ev-sand-ink)]',
  protected: 'hatch [--rule:var(--ev-sage-rule)] text-[var(--ev-sage-ink)]',
  deadline: '',
}

function layoutDay(evs: CalEvent[]) {
  const sorted = [...evs].sort((a, b) => a.start - b.start || b.end - a.end)
  const pos = new Map<string, { col: number; cols: number }>()
  let cluster: CalEvent[] = []
  let cols: number[] = []
  let clusterEnd = 0
  const flush = () => {
    const n = Math.max(1, ...cluster.map((e) => pos.get(e.id)!.col + 1))
    cluster.forEach((e) => (pos.get(e.id)!.cols = n))
    cluster = []
    cols = []
  }
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush()
    let c = cols.findIndex((end) => end <= e.start)
    if (c === -1) c = cols.push(0) - 1
    cols[c] = e.end
    pos.set(e.id, { col: c, cols: 1 })
    cluster.push(e)
    clusterEnd = Math.max(clusterEnd, e.end)
  }
  if (cluster.length) flush()
  return pos
}

interface Props {
  days: number[]
  now: number
  events: CalEvent[]
  pal: PalId
  highlight: Set<string>
  onOpen: (e: CalEvent, r: DOMRect) => void
  quiet: [number, number]
}

export function Calendar({ days, now, events, pal, highlight, onOpen, quiet }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const h0 = Math.min(EARLIEST, ...events.filter((e) => e.kind !== 'deadline' && days.includes(startOfDay(e.start))).map((e) => new Date(e.start).getHours()))
  useEffect(() => {
    const h = new Date(now).getHours()
    scroller.current?.scrollTo({ top: Math.max(0, (h - h0 - 1.5) * PX) })
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const first = events.find((e) => highlight.has(e.id))
  useEffect(() => {
    if (!first || !scroller.current) return
    const h = new Date(first.start).getHours()
    scroller.current.scrollTo({ top: Math.max(0, (h - h0 - 1) * PX), behavior: 'smooth' })
  }, [first?.id])

  const today = startOfDay(now)
  const hours = Array.from({ length: H1 - h0 }, (_, i) => h0 + i)

  return (
    <div ref={scroller} className="relative h-full overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-20 grid bg-paper/55 backdrop-blur-xl" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0,1fr))` }}>
        <div />
        {days.map((d) => {
          const isToday = d === today
          return (
            <div key={d} className="px-2 pt-3 pb-2.5">
              <div className={`text-[11px] font-medium tracking-[0.06em] uppercase ${isToday ? 'text-tangerine' : 'text-ink-3'}`}>
                {new Date(d).toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`font-sans text-[20px] font-bold leading-none tracking-tight ${d < today ? 'text-ink-3' : 'text-ink'}`}>{new Date(d).getDate()}</span>
                {isToday && <span className="size-1.5 rounded-full bg-tangerine" />}
              </div>
            </div>
          )
        })}
        <div className="pointer-events-none absolute inset-x-0 -bottom-4 h-4 bg-gradient-to-b from-[var(--paper)]/70 to-transparent" />
      </div>

      <div className="relative grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0,1fr))`, height: (H1 - h0) * PX }}>
        <div className="relative">
          {hours.map((h) => (
            <div key={h} className="tnum absolute right-2.5 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: (h - h0) * PX }}>
              {h === h0 ? '' : `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`}
            </div>
          ))}
        </div>

        {days.map((d) => {
          const dayEvents = events.filter((e) => e.kind !== 'deadline' && e.start < at(d, H1) && e.end > at(d, h0) && startOfDay(e.start) === d)
          const deadlines = events.filter((e) => e.kind === 'deadline' && startOfDay(e.start) === d)
          const pos = layoutDay(dayEvents)
          const isToday = d === today
          return (
            <div key={d} className={`relative border-l border-hair ${d < today ? 'bg-paper-2/40' : ''}`}>
              {hours.map((h) => (
                <div key={h} className="absolute inset-x-0 border-t border-hair" style={{ top: (h - h0) * PX }}>
                  <div className="absolute inset-x-0 border-t border-dotted border-hair opacity-60" style={{ top: PX / 2 }} />
                </div>
              ))}
              {/* quiet hours */}
              <div className="absolute inset-x-0 top-0 bg-paper-3/50" style={{ height: (quiet[1] - h0) * PX }} />
              <div className="absolute inset-x-0 bottom-0 bg-paper-3/50" style={{ height: (H1 - quiet[0]) * PX }} />

              {dayEvents.map((e) => {
                const p = pos.get(e.id)!
                const top = ((Math.max(e.start, at(d, h0)) - at(d, h0)) / HOUR) * PX
                const height = Math.max(20, (hoursOf(e) * PX) - 2)
                const short = hoursOf(e) < 0.75
                const G = Glyph[e.kind]
                const ghost = e.status === 'proposed'
                const gi = ghost ? dayEvents.filter((x) => x.status === 'proposed').indexOf(e) : 0
                return (
                  <button
                    key={e.id}
                    onClick={(ev) => onOpen(e, (ev.currentTarget as HTMLElement).getBoundingClientRect())}
                    className={`press group absolute overflow-hidden ${short ? 'rounded-[10px]' : 'rounded-[14px]'} pr-2 pl-3 text-left transition-[background-color,opacity,filter] duration-200
                      ${ghost ? 'ghost [--rule:var(--tangerine)] text-ink' : KIND[e.kind]}
                      ${e.status === 'done' ? 'opacity-50' : ''} ${highlight.has(e.id) ? 'flash' : ''}`}
                    style={{ top: top + 1, height, left: `calc(${(p.col / p.cols) * 100}% + 3px)`, width: `calc(${100 / p.cols}% - 6px)`, '--i': gi } as React.CSSProperties}
                  >
                    <span className="absolute top-1.5 bottom-1.5 left-1 w-[3px] rounded-full bg-[var(--rule)]" />
                    <div className={`flex min-w-0 items-center gap-1 ${short ? 'h-full' : 'pt-1.5'}`}>
                      <G className="size-3 shrink-0 opacity-80" />
                      <span className="truncate text-[12px] leading-tight font-semibold">{e.title}</span>
                      {e.seg && !short && <span className="tnum ml-auto shrink-0 text-[10px] opacity-60">{e.seg}</span>}
                      {e.status === 'done' && <Check className="ml-auto size-3 shrink-0" />}
                      {e.status === 'missed' && <span className="ml-auto grid size-3.5 shrink-0 place-items-center rounded-full bg-amber text-[9px] font-bold text-paper">?</span>}
                    </div>
                    {!short && <div className="tnum mt-0.5 truncate text-[11px] opacity-70">{fmtTime(e.start)} – {fmtTime(e.end)}</div>}
                    {!short && e.note && <div className="mt-0.5 truncate text-[11px] font-medium text-tangerine">{e.note}</div>}
                    {ghost && hoursOf(e) >= 1 && (
                      <span className="absolute right-1 bottom-1"><Pal id={pal} size={18} animate={false} /></span>
                    )}
                  </button>
                )
              })}

              {deadlines.map((e) => (
                <button
                  key={e.id}
                  onClick={(ev) => onOpen(e, (ev.currentTarget as HTMLElement).getBoundingClientRect())}
                  className="absolute inset-x-0 z-10 flex -translate-y-1/2 items-center"
                  style={{ top: Math.min(((e.start - at(d, h0)) / HOUR) * PX, (H1 - h0) * PX - 10) }}
                  title={`Due: ${e.title}`}
                >
                  <span className="h-[2px] flex-1 bg-ink" />
                  <span className="flex items-center gap-1 rounded-full bg-ink py-0.5 pr-2 pl-1.5 text-[10px] font-semibold text-paper">
                    <Glyph.deadline className="size-2.5" /> Due
                  </span>
                </button>
              ))}

              {isToday && now >= at(d, h0) && (
                <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: ((now - at(d, h0)) / HOUR) * PX }}>
                  <div className="h-px bg-tangerine" />
                  <div className="absolute -top-[3px] -left-[4px] size-[7px] rounded-[2.5px] bg-tangerine" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function LoadStrip({ weekStart, events, onPick, active }: { weekStart: number; events: CalEvent[]; onPick?: (i: number) => void; active?: number }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const load = days.map((d) =>
    events
      .filter((e) => startOfDay(e.start) === d && e.kind !== 'deadline' && e.kind !== 'commute' && e.status !== 'proposed')
      .reduce((a, e) => a + hoursOf(e), 0),
  )
  return (
    <div className="flex items-end gap-1" aria-label="Committed hours per day">
      {load.map((h, i) => (
        <button key={i} onClick={() => onPick?.(i)} className="group flex flex-col items-center gap-1" title={`${h.toFixed(1)}h committed`}>
          <div className="relative h-6 w-3.5 overflow-hidden rounded-[3px] bg-paper-3">
            <div className={`absolute inset-x-0 bottom-0 ${active === i ? 'bg-tangerine' : 'bg-ink/70'} transition-[height] duration-500`} style={{ height: `${Math.min(100, (h / 12) * 100)}%` }} />
          </div>
          <span className="tnum text-[9px] text-ink-3">{Math.round(h)}</span>
        </button>
      ))}
    </div>
  )
}
