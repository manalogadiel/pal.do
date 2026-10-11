import { useCallback, useEffect, useRef, useState } from 'react'
import { describeDraft, type Card } from '../lib/agent'
import { fmtDay, fmtHours, fmtTime, type CalEvent, type PalId, type PalState } from '../lib/core'
import { Pal } from '../pals/Pal'
import { ChevronL, Glyph, Mic, Send, Speaker, SpeakerOff } from './Icons'

/** The pal's current line: greeting or latest reply. Lives only in the speech bubble. */
export interface MascotBubble {
  id: string
  mascotId: PalId
  text: string
  kind: 'greeting' | 'response'
}

export interface Msg {
  id: string
  from: 'pal' | 'me'
  text: string
  card?: Card
  chips?: string[]
  rule?: string
  resolved?: string
}

const STATE_LABEL: Record<PalState, string> = {
  idle: 'here', listening: 'listening', talking: 'talking', sleeping: 'quiet hours', alert: 'heads-up',
  alarmed: 'uh-oh', shocked: 'whoa', happy: 'yay', wave: 'hi!', cheer: 'nice!',
}

interface Props {
  msgs: Msg[]
  bubble: MascotBubble | null
  pal: PalId
  palName: string
  palState: PalState
  events: CalEvent[]
  onSend: (t: string) => void
  onCard: (msgId: string, action: string, arg?: string) => void
  onHover: (ids: string[]) => void
  onTyping: (on: boolean) => void
  onPoke: () => void
  voiceOn: boolean
  setVoiceOn: (v: boolean) => void
  micOn: boolean
  toggleMic: () => void
  micSupported: boolean
  /** live words while the mic listens */
  interim?: string
  /** larger pal on the Home stage */
  big?: boolean
  noPal?: boolean
  /** mobile: log collapses behind the stage */
  compact?: boolean
  open?: boolean
  setOpen?: (v: boolean) => void
  onCollapse?: () => void
}

/* Typewriter for the pal's bubble. It stays until it's replaced; no dismiss timer. */
function useSpeech(bubble: MascotBubble | null) {
  const [n, setN] = useState(Infinity)
  const seen = useRef(bubble?.id)
  useEffect(() => {
    // Don't re-type the line restored on page load (id compare is StrictMode-safe)
    if (bubble?.id === seen.current) return
    seen.current = bubble?.id
    setN(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? Infinity : 0)
  }, [bubble?.id])
  const len = bubble?.text.length ?? 0
  const typing = n < len
  useEffect(() => {
    if (!typing) return
    const i = setInterval(() => setN((v) => v + 2), 36)
    return () => clearInterval(i)
  }, [typing])
  return { shown: bubble?.text.slice(0, n) ?? '', typing, skip: () => setN(Infinity) }
}

export function Chat(p: Props) {
  const [text, setText] = useState('')
  const [voiceMode, setVoiceMode] = useState(false)
  const feedRef = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const speech = useSpeech(p.bubble)

  useEffect(() => {
    if (p.open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [p.open])

  useEffect(() => {
    if (p.micOn) setVoiceMode(true)
  }, [p.micOn])
  // The pal row floats over the feed while the log is showing; the feed pads itself to clear it
  const overlay = !p.compact || !!p.open
  const rowRef = useRef<HTMLDivElement>(null)
  // Default to full pal height so spacer is correctly sized on frame 0 during page reload
  const defaultRowH = p.compact ? 80 : 120
  const [rowH, setRowH] = useState(defaultRowH)
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const h = e.contentRect.height
      if (h > 0) setRowH(h)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const shownState: PalState = speech.typing && (p.palState === 'idle' || p.palState === 'sleeping') ? 'talking' : p.palState
  const logOpen = !p.compact || p.open

  const scrollToBottom = useCallback((instant = false) => {
    if (feedRef.current) {
      feedRef.current.scrollTo({
        top: feedRef.current.scrollHeight,
        behavior: instant ? 'auto' : 'smooth',
      })
    }
    end.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'end' })
  }, [])

  // Auto-scroll when messages update, card resolves, log opens, or pal height settles
  useEffect(() => {
    scrollToBottom(false)
  }, [p.msgs.length, p.msgs.at(-1)?.resolved, p.open, rowH, scrollToBottom])

  // On page mount / reload, ensure feed immediately scrolls to bottom so the last bubble is on top of the mascot
  useEffect(() => {
    scrollToBottom(true)
    const t1 = setTimeout(() => scrollToBottom(true), 50)
    const t2 = setTimeout(() => scrollToBottom(true), 150)
    const t3 = setTimeout(() => scrollToBottom(false), 300)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [scrollToBottom])

  const send = () => {
    if (!text.trim()) return
    p.onSend(text)
    setText('')
  }
  const speechBubble = (row: boolean) => {
    // When the chat log is open and has messages, keep the message in the chat feed (on top)
    // and don't duplicate it in the floating mascot bubble.
    const isDuplicate = logOpen && (p.msgs.length > 0 || p.msgs.some((m) => m.from === 'pal' && m.text === p.bubble?.text))
    return p.bubble && !isDuplicate ? (
      <button
        key={p.bubble.id}
        onClick={() => speech.typing && speech.skip()}
        className={`pop pointer-events-auto relative block max-w-full rounded-[20px] bg-paper px-3.5 py-2 text-left text-[13.5px] leading-snug text-ink shadow-[var(--edge),0_8px_24px_-12px_rgb(60_44_30/0.35)] origin-bottom-left rounded-bl-[6px] ${row ? 'mb-1 w-fit min-w-0 flex-initial' : ''}`}
        aria-label={speech.typing ? 'Show full reply' : `${p.palName} says`}
        aria-live="polite"
      >
        <span className={`block max-h-[5.5em] overflow-y-auto break-words whitespace-pre-wrap ${speech.typing ? 'caret' : ''}`}>{speech.shown}</span>
      </button>
    ) : (
      <div className={`pointer-events-auto flex items-center gap-1.5 pb-1 text-[12px] text-ink-3 ${row ? 'mb-1 min-w-0 flex-1' : ''}`}>
        <span className={`size-1.5 rounded-[2px] ${shownState === 'sleeping' ? 'bg-ink-3' : 'pulse-dot bg-tangerine'}`} />
        <span className="font-medium text-ink-2">{p.palName}</span>
        <span>· {STATE_LABEL[shownState]}</span>
      </div>
    )
  }
  const firstRun = !p.msgs.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: name, state, controls — no rules, just type */}
      {logOpen && (
        <div className="flex items-center gap-2 px-6 pt-5 pb-1">
          {p.onCollapse && (
            <button onClick={p.onCollapse} className="press -ml-2 grid size-8 place-items-center rounded-full text-ink-3 hover-lift" aria-label="Hide chat (⌘/)" title="Hide chat  ⌘/">
              <ChevronL />
            </button>
          )}
          {p.compact && (
            <button onClick={() => p.setOpen?.(false)} className="press -ml-2 h-8 rounded-full px-2.5 text-[13px] text-ink-3 hover-lift">Done</button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => p.setVoiceOn(!p.voiceOn)}
            className="press grid size-9 place-items-center rounded-full text-ink-2 hover-lift"
            aria-label={p.voiceOn ? 'Mute spoken replies' : 'Speak replies aloud'}
            title={p.voiceOn ? 'Spoken replies on' : 'Spoken replies off'}
          >
            {p.voiceOn ? <Speaker /> : <SpeakerOff />}
          </button>
        </div>
      )}

      {/* Log */}
      <div className={`grid min-h-0 overflow-hidden ${p.compact ? 'drawer' : 'flex-1 grid-rows-[minmax(0,1fr)]'}`} style={p.compact ? { gridTemplateRows: p.open ? '1fr' : '0fr', flex: p.open ? '1 1 0%' : '0 0 auto' } : undefined}>
        <div ref={feedRef} className={`fade-top min-h-0 overflow-y-auto overscroll-contain px-6 ${logOpen ? 'pt-4 pb-2' : 'invisible'}`} role="log" aria-live="polite">
          {firstRun ? (
            <div className="land pt-[6vh] pb-6">
              <div className="text-[13px] font-medium text-ink-3">{greetingTime()}</div>
              <h2 className="mt-1 max-w-[16ch] font-serif text-[38px] leading-[1.02] tracking-[-0.02em]">
                Tell {p.palName} what your week looks like.
              </h2>
              <p className="mt-3 max-w-[38ch] text-[14.5px] leading-[1.55] text-ink-2">
                Classes, shifts, deadlines. Type it or say it. {p.palName} asks about anything missing and suggests times. You decide.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {['Bio exam Friday', 'Shift Sat 2-8pm', "How's my week?", 'Paste my syllabus'].map((c, i) => (
                  <Chip key={c} i={i} onClick={() => p.onSend(c)}>{c}</Chip>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {p.msgs.map((m) => (
                <div key={m.id} className={`land flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                  {m.from === 'me' ? (
                    <div className="max-w-[82%] rounded-[22px] rounded-br-[8px] bg-ink/[0.06] px-4 py-2.5 text-[14.5px] leading-snug">{m.text}</div>
                  ) : (
                    <div className="max-w-[90%] min-w-0 space-y-2">
                      {m.text && (
                        <div className="rounded-[22px] rounded-bl-[8px] bg-paper px-4 py-2.5 text-[14.5px] leading-relaxed shadow-[0_2px_10px_-2px_rgba(0,0,0,0.06)] border border-ink/[0.06] text-ink">
                          {m.text}
                        </div>
                      )}
                      {m.card && <CardView m={m} {...p} />}
                      {m.rule && <div className="mt-1 font-pixel text-[9px] tracking-wide text-ink-3 uppercase">{m.rule}</div>}
                      {m.chips && !m.resolved && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.chips.map((c, i) => (
                            <Chip key={c} i={i} onClick={() => { p.onCard(m.id, 'chip'); p.onSend(c) }}>{c}</Chip>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* Spacer = pal row height, so scrolling to the end lifts the newest message above the pal */}
          <div ref={end} aria-hidden style={overlay ? { height: rowH + 20 } : undefined} />
        </div>
      </div>

      {/* Stage: the pal stands on the composer and talks */}
      <div className={`relative z-20 px-4 pb-4 ${p.compact ? 'pt-2' : 'pt-3'}`}>
        {/* Transparent overlay above the input: taps pass through to the feed except on the pal and bubble */}
        <div ref={rowRef} className={overlay ? 'pointer-events-none absolute inset-x-4 bottom-full z-10' : ''}>
        {/* One compact row at every width: pal left, bubble pill right, bottoms aligned */}
        <div className="mb-2 flex items-end gap-2.5 pl-1">
          {!p.noPal && <Pal id={p.pal} state={shownState} size={p.compact ? 64 : 92} float onPoke={p.onPoke} className="pointer-events-auto relative z-10 shrink-0" />}
          {speechBubble(true)}
        </div>
        </div>

        {/* Glow sits behind the input + mic only */}
        <div className="input-glow relative z-20" data-time={timeOfDay()}>
          {!voiceMode ? (
            <div className="relative flex items-end gap-1.5 rounded-[28px] bg-ink/[0.05] p-1.5 pl-5 transition-[background-color,box-shadow] duration-200 focus-within:bg-ink/[0.07]">
              <textarea
                ref={inputRef}
                value={text}
                rows={1}
                onChange={(e) => setText(e.target.value)}
                onFocus={() => { p.onTyping(true); if (p.compact) p.setOpen?.(true) }}
                onBlur={() => p.onTyping(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={`Tell ${p.palName} your plan…`}
                className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent py-[11px] text-[16px] leading-snug outline-none placeholder:text-ink-3"
                aria-label="Message"
              />
              {text.trim() ? (
                <button onClick={send} className="pop press grid size-11 shrink-0 place-items-center rounded-full bg-ink text-paper" aria-label="Send">
                  <Send />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setVoiceMode(true)
                    if (p.compact) p.setOpen?.(true)
                  }}
                  className="press grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover-lift hover:text-ink"
                  aria-label="Switch to voice mode"
                  title="Voice mode"
                >
                  <Mic className="size-5" />
                </button>
              )}
            </div>
          ) : (
            <div className="py-1">
              <MicOrb
                on={p.micOn}
                supported={p.micSupported}
                toggle={p.toggleMic}
                size={p.compact ? 64 : 84}
                interim={p.interim}
                onBack={() => {
                  setVoiceMode(false)
                  if (p.micOn) p.toggleMic()
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Big mic: tap to toggle, or press and hold to talk and release to send. */
function MicOrb({
  on,
  supported,
  toggle,
  size,
  interim,
  onBack,
}: {
  on: boolean
  supported: boolean
  toggle: () => void
  size: number
  interim?: string
  onBack?: () => void
}) {
  const press = useRef<{ t: number; wasOn: boolean } | null>(null)
  const [held, setHeld] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const down = (e: React.PointerEvent) => {
    if (!supported) return toggle()
    e.currentTarget.setPointerCapture(e.pointerId)
    press.current = { t: Date.now(), wasOn: on }
    if (!on) toggle()
    holdTimer.current = setTimeout(() => setHeld(true), 350)
  }
  const up = () => {
    clearTimeout(holdTimer.current)
    const pr = press.current
    press.current = null
    setHeld(false)
    if (!pr) return
    if (pr.wasOn || Date.now() - pr.t > 350) toggle()
  }
  const label = !supported
    ? 'Voice needs Chrome or Edge'
    : held
    ? 'Release to send'
    : on
    ? interim || 'Listening… tap to stop'
    : 'Tap or hold to talk'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex w-full items-center justify-center">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="press absolute left-1 grid size-11 place-items-center rounded-full bg-ink/[0.05] text-ink-2 hover-lift hover:text-ink"
            aria-label="Back to text mode"
            title="Back to text mode"
          >
            <ChevronL />
          </button>
        )}
        <button
          onPointerDown={down}
          onPointerUp={up}
          onPointerCancel={up}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle()
            }
          }}
          style={{ width: size, height: size }}
          className={`relative grid touch-none place-items-center rounded-full text-white transition-transform duration-200 [transition-timing-function:var(--ease-out)] select-none [-webkit-touch-callout:none] ${supported ? 'bg-tangerine shadow-[0_14px_30px_-10px_var(--tangerine)]' : 'bg-ink/25'} ${held ? 'scale-110' : 'active:scale-95'}`}
          aria-label={label}
          aria-pressed={on}
        >
          {on && (
            <>
              <span className="ring absolute inset-0 rounded-full bg-tangerine" />
              <span className="ring ring-2 absolute inset-0 rounded-full bg-tangerine" />
            </>
          )}
          <Mic className={`relative ${size > 70 ? 'size-8' : 'size-6'}`} />
        </button>
      </div>
      <span className={`max-w-[280px] truncate text-center text-[12px] font-medium ${on ? 'text-tangerine' : 'text-ink-3'}`}>
        {label}
      </span>
    </div>
  )
}

function timeOfDay() {
  const h = new Date().getHours()
  return h < 12 && h >= 5 ? 'morning' : h < 18 && h >= 12 ? 'afternoon' : 'night'
}

function greetingTime() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Chip({ children, onClick, i = 0 }: { children: React.ReactNode; onClick: () => void; i?: number }) {
  return (
    <button onClick={onClick} style={{ '--i': i } as React.CSSProperties} className="chip-in press h-9 rounded-full bg-ink/[0.05] px-4 text-[13.5px] text-ink-2 hover-lift hover:text-ink">
      {children}
    </button>
  )
}

function Btn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`press h-9 rounded-full px-4 text-[13.5px] font-medium ${primary ? 'bg-tangerine text-white shadow-[0_6px_14px_-8px_var(--tangerine)]' : 'text-ink-2 hover-lift hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

const Done = ({ t }: { t: string }) => (
  <div className="land mt-2.5 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3">
    <span className="size-1.5 rounded-[2px] bg-ink-3/60" />{t}
  </div>
)

/* Inline content, not cards: soft tonal pills + text actions. */
function CardView({ m, events, onCard, onHover }: { m: Msg } & Props) {
  const c = m.card!
  const [why, setWhy] = useState(false)
  const done = m.resolved
  const wrap = 'pop mt-3 origin-top-left'

  if (c.type === 'readback') {
    const parts = describeDraft(c.draft).filter(Boolean)
    return (
      <div className={wrap}>
        <div className="flex flex-wrap items-center gap-1.5">
          {parts.map((t, i) => (
            <span key={i} className={`rounded-full px-3 py-1.5 text-[13.5px] ${i === 0 ? 'bg-tangerine-soft font-semibold text-ink' : 'bg-ink/[0.05] text-ink-2'}`}>{t}</span>
          ))}
        </div>
        {done ? <Done t={done} /> : (
          <div className="mt-3 -ml-1 flex gap-1">
            <Btn primary onClick={() => onCard(m.id, 'confirm')}>Looks right</Btn>
            <Btn onClick={() => onCard(m.id, 'fix')}>Change something</Btn>
          </div>
        )}
      </div>
    )
  }

  if (c.type === 'proposal') {
    const blocks = c.blockIds.map((id) => events.find((e) => e.id === id)).filter(Boolean) as CalEvent[]
    return (
      <div className={wrap} onMouseEnter={() => onHover(c.blockIds)} onMouseLeave={() => onHover([])}>
        <ol className="space-y-1.5">
          {blocks.map((b, i) => (
            <li
              key={b.id}
              style={{ '--i': i } as React.CSSProperties}
              className={`chip-in flex h-10 items-center gap-3 rounded-full pr-4 pl-1.5 text-[13.5px] transition-colors duration-300 ${b.status === 'proposed' ? 'bg-tangerine-soft' : 'bg-ink/[0.04]'}`}
            >
              <span className={`grid size-7 place-items-center rounded-full text-[11px] font-semibold tnum ${b.status === 'proposed' ? 'bg-paper/80 text-tangerine' : 'bg-paper/80 text-ink-2'}`}>{i + 1}</span>
              <span className="w-[78px] shrink-0 text-ink-2">{fmtDay(b.start).replace(/,.*/, '')}</span>
              <span className="tnum font-medium">{fmtTime(b.start)} – {fmtTime(b.end)}</span>
              <span className="tnum ml-auto text-[12px] text-ink-3">{fmtHours((b.end - b.start) / 3_600_000)}</span>
            </li>
          ))}
          {!blocks.length && <li className="text-[13.5px] text-ink-3">No blocks fit before the deadline.</li>}
        </ol>
        {c.shortfall > 0 && (
          <p className="mt-3 text-[13.5px] leading-snug text-amber">
            {fmtHours(c.shortfall)} won't fit before the deadline (about {fmtHours(c.freeHours)} free). You could trim the scope, ask about an extension, or move something. Your call.
          </p>
        )}
        <button onClick={() => setWhy(!why)} className="mt-2.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink-2">
          {why ? 'Hide reasoning' : 'Why these times?'}
        </button>
        {why && <p className="pop mt-1 text-[13px] leading-snug text-ink-2">{c.why}</p>}
        {done ? <Done t={done} /> : (
          <div className="mt-2.5 -ml-1 flex flex-wrap gap-1">
            <Btn primary onClick={() => onCard(m.id, 'accept')}>Accept</Btn>
            {c.commute && <Btn onClick={() => onCard(m.id, 'commute')}>+ Flashcards on bus rides</Btn>}
            <Btn onClick={() => onCard(m.id, 'decline')}>Not now</Btn>
          </div>
        )}
      </div>
    )
  }

  if (c.type === 'checkin') {
    const evs = c.eventIds.map((id) => events.find((e) => e.id === id)).filter(Boolean) as CalEvent[]
    return (
      <div className={`${wrap} space-y-4`}>
        {evs.map((e) => {
          const answered = e.status === 'done' || e.status === 'missed'
          return (
            <div key={e.id}>
              <div className="flex items-baseline gap-2 text-[14px]">
                <Glyph.work className="size-3.5 translate-y-[2px] text-ink-3" />
                <span className="font-semibold">{e.title}</span>
                <span className="tnum ml-auto text-[12px] text-ink-3">{fmtTime(e.start)}–{fmtTime(e.end)}</span>
              </div>
              {answered ? <Done t={e.status === 'done' ? 'Done' : 'Moved to new times'} /> : (
                <div className="mt-2 -ml-1 flex gap-1">
                  <Btn primary onClick={() => onCard(m.id, 'done', e.id)}>Done</Btn>
                  <Btn onClick={() => onCard(m.id, 'partly', e.id)}>Partly</Btn>
                  <Btn onClick={() => onCard(m.id, 'notyet', e.id)}>Not yet</Btn>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (c.type === 'event') {
    const G = Glyph[(c.kind as keyof typeof Glyph) ?? 'shift'] ?? Glyph.shift
    return (
      <div className={wrap}>
        <div className="inline-flex min-h-10 flex-wrap items-center gap-2.5 rounded-full bg-ink/[0.04] pr-4 pl-3 text-[13.5px]">
          <G className="size-4 text-ink-2" />
          <span className="font-semibold">{c.title}</span>
          <span className="tnum text-ink-2">
            {c.days?.length
              ? c.days.length === 7 ? 'Every day' : [...c.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')
              : fmtDay(c.start).replace(/,.*/, '')} · {fmtTime(c.start)} – {fmtTime(c.end)}
          </span>
        </div>
        {c.conflicts > 0 && (
          <p className="mt-2.5 text-[13.5px] leading-snug text-amber">
            This overlaps {c.conflicts} planned block{c.conflicts > 1 ? 's' : ''}. I can suggest new times for them if you add it.
          </p>
        )}
        {done ? <Done t={done} /> : (
          <div className="mt-2.5 -ml-1 flex gap-1">
            <Btn primary onClick={() => onCard(m.id, 'addEvent')}>{c.conflicts ? 'Add and re-plan' : 'Add it'}</Btn>
            <Btn onClick={() => onCard(m.id, 'skipEvent')}>Never mind</Btn>
          </div>
        )}
      </div>
    )
  }

  if (c.type === 'notify') {
    return (
      <div className={wrap}>
        <p className="text-[13.5px] leading-snug text-ink-2">Heads-up 10 min before a block, and a check-in after. Quiet hours stay quiet, and you get at most 3 check-ins a day.</p>
        {done ? <Done t={done} /> : (
          <div className="mt-2.5 -ml-1 flex gap-1">
            <Btn primary onClick={() => onCard(m.id, 'notifyOn')}>Turn on reminders</Btn>
            <Btn onClick={() => onCard(m.id, 'notifyOff')}>In-app only</Btn>
          </div>
        )}
      </div>
    )
  }

  return null
}

export function Boundary({ name }: { name: string }) {
  return (
    <div>
      <div className="text-[12px] font-medium text-ink-3">What {name} won't do</div>
      <ul className="mt-2.5 space-y-2 text-[14px] leading-snug text-ink-2">
        {['Write, solve, or summarize your graded work', "Predict grades or tell you what you'll score", 'Judge how stressed or tired you are', 'Change your calendar without your tap'].map((t) => (
          <li key={t} className="flex items-start gap-2.5">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-tangerine" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}
