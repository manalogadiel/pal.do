import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { describeDraft, type Card } from '../lib/agent'
import { fmtDay, fmtHours, fmtTime, type CalEvent, type PalId, type PalState } from '../lib/core'
import { Pal } from '../pals/Pal'
import { Calendar, Cards, ChevronL, Clip, Glyph, Mic, Quiz, Send, Speaker, SpeakerOff } from './Icons'
import type { HandsFreeState } from '../lib/handsfree'

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
  dismissal?: boolean
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
  /** Hands-free "Hi {pal}": its state for the status chip, and the on/off switch */
  /** Always on once set up (no switch): just say "Hi {pal}". tap: the browser wants one tap before audio runs */
  handsFree?: { on: boolean; state: HandsFreeState; progress?: number; mic?: boolean; tap?: boolean; error?: string; heard?: string }
  /** The AI is working on a reply: "• • •" in the log, so nobody types the same thing twice */
  thinking?: boolean
  onCancelReply?: () => void
  /** The paperclip: a reviewer, handout or notes for the Study library */
  onAttach?: (files: File[]) => void
}

/** What the hands-free chip says, and its dot */
function handsFreeChip(h: NonNullable<Props['handsFree']>, palName: string): { label: string; dot: string } {
  // Their words as they talk (on-device preview), then what it finally heard
  if (h.heard && h.state !== 'loading' && h.state !== 'off') return { label: `“${h.heard}”`, dot: 'bg-accent animate-pulse' }
  if (h.state === 'loading' && h.mic) return { label: 'Allow the microphone (the prompt by the address bar)', dot: 'bg-amber animate-pulse' }
  if (h.state === 'loading' && h.tap) return { label: `Tap anywhere once, then say "Hi ${palName}"`, dot: 'bg-amber animate-pulse' }
  if (h.state === 'loading') return { label: (h.progress ?? 0) >= 1 ? 'Starting the mic…' : `Getting ready… ${Math.round((h.progress ?? 0) * 100)}%`, dot: 'bg-ink-3' }
  if (h.state === 'awake') return { label: 'Listening…', dot: 'bg-accent animate-pulse' }
  if (h.state === 'thinking') return { label: 'Got it…', dot: 'bg-accent' }
  if (h.state === 'paused') return { label: `${palName} is talking… say "Hi ${palName}" to interrupt`, dot: 'bg-ink-3' }
  if (h.state === 'error') return { label: h.error === 'mic-blocked' ? 'Mic blocked: allow it by the address bar, then tap here' : h.error === 'no-mic' ? 'No microphone found' : "Listening couldn't start: tap to retry", dot: 'bg-rose-500' }
  if (h.state === 'off') return { label: `Tap anywhere once, then say "Hi ${palName}"`, dot: 'bg-amber animate-pulse' }
  return { label: `Say "Hi ${palName}"`, dot: 'bg-emerald-500' }
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
  const contentRef = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const speech = useSpeech(p.bubble)

  useEffect(() => {
    if (p.open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [p.open])

  // Hands-free woke ("Hi Rei"): show the same open mic as tapping it
  const hfAwake = p.handsFree?.state === 'awake'
  useEffect(() => {
    if (p.micOn || hfAwake) setVoiceMode(true)
  }, [p.micOn, hfAwake])
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

  const scrollToBottom = useCallback(() => {
    if (feedRef.current) {
      feedRef.current.scrollTo({
        top: feedRef.current.scrollHeight,
        behavior: 'auto',
      })
    }
  }, [])

  // Follow growing replies and composer changes, while allowing people to scroll back through history.
  useLayoutEffect(() => {
    if (followBottom.current) scrollToBottom()
  }, [p.msgs, p.open, rowH, p.thinking, voiceMode, p.micOn, p.interim, p.handsFree?.heard, scrollToBottom])

  useEffect(() => {
    const feed = feedRef.current
    const content = contentRef.current
    if (!feed || !content) return
    const resize = new ResizeObserver(() => {
      if (followBottom.current) scrollToBottom()
    })
    resize.observe(feed)
    resize.observe(content)
    return () => resize.disconnect()
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
        className={`pop pointer-events-auto relative block max-w-full rounded-[20px] bg-paper px-3.5 py-2 text-left text-[13.5px] leading-snug text-ink shadow-[var(--edge),0_8px_24px_-12px_rgb(20_48_88/0.35)] origin-bottom-left rounded-bl-[6px] ${row ? 'mb-1 w-fit min-w-0 flex-initial' : ''}`}
        aria-label={speech.typing ? 'Show full reply' : `${p.palName} says`}
        aria-live="polite"
      >
        <span className={`block max-h-[5.5em] overflow-y-auto break-words whitespace-pre-wrap ${speech.typing ? 'caret' : ''}`}>{speech.shown}</span>
      </button>
    ) : (
      <div className={`pointer-events-auto flex items-center gap-1.5 pb-1 text-[12px] text-ink-3 ${row ? 'mb-1 min-w-0 flex-1' : ''}`}>
        <span className={`size-1.5 rounded-[2px] ${shownState === 'sleeping' ? 'bg-ink-3' : 'pulse-dot bg-accent'}`} />
        <span className="font-medium text-ink-2">{p.palName}</span>
        <span>· {p.thinking ? 'thinking…' : STATE_LABEL[shownState]}</span>
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
        <div ref={feedRef} onScroll={() => {
          const feed = feedRef.current
          if (feed) followBottom.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 96
        }} className={`fade-top min-h-0 overflow-y-auto overscroll-contain px-6 ${logOpen ? 'pt-4 pb-2' : 'invisible'}`} role="log" aria-live="polite">
          <div ref={contentRef}>
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
                <div key={m.id} data-msg data-from={m.from} className={`land flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
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
              {p.thinking && (
                <div className="land flex justify-start" role="status" aria-label={`${p.palName} is thinking`}>
                  <div className="flex h-[42px] items-center gap-1.5 rounded-[22px] rounded-bl-[8px] border border-ink/[0.06] bg-paper px-4 shadow-[0_2px_10px_-2px_rgba(0,0,0,0.06)]">
                    {[0, 160, 320].map((d) => (
                      <span key={d} className="size-1.5 rounded-full bg-ink-3 motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                    {p.onCancelReply && <button type="button" aria-label="Cancel reply" onClick={p.onCancelReply} className="ml-2 text-[12px] text-ink-2">Cancel</button>}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Spacer = pal row height, so scrolling to the end lifts the newest message above the pal */}
          <div aria-hidden style={overlay ? { height: rowH + 20 } : undefined} />
          </div>
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
          {p.handsFree?.on && (() => {
            const chip = handsFreeChip(p.handsFree, p.palName)
            return (
              <div className="mb-2 flex justify-center">
                <div className="inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-ink/[0.05] px-3 text-[12.5px] font-medium text-ink-2">
                  <span className={`size-2 shrink-0 rounded-full ${chip.dot}`} aria-hidden />
                  <span className="truncate" aria-live="polite">{chip.label}</span>
                </div>
              </div>
            )
          })()}
          {!voiceMode ? (
            <div className={`relative flex items-end gap-1.5 rounded-[28px] bg-ink/[0.05] p-1.5 transition-[background-color,box-shadow] duration-200 focus-within:bg-ink/[0.07] ${p.onAttach ? 'pl-1.5' : 'pl-5'}`}>
              {p.onAttach && (
                <>
                  <button type="button" onClick={() => fileRef.current?.click()} className="press grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:text-ink" aria-label="Attach a reviewer or notes" title="Attach a reviewer or notes">
                    <Clip className="size-[18px]" />
                  </button>
                  <input ref={fileRef} type="file" accept=".pdf,.txt,.md,image/*" multiple hidden onChange={(e) => { const files=[...(e.target.files??[])]; if(files.length)p.onAttach!(files); e.target.value = '' }} />
                </>
              )}
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
                handsFree={p.handsFree && { on: p.handsFree.on, palName: p.palName, awake: hfAwake, thinking: p.handsFree.state === 'thinking', heard: p.handsFree.heard }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** A long sentence shows its newest words: that's the part they're saying right now */
const latest = (t: string) => (t.length > 90 ? `…${t.slice(-90).replace(/^\S*\s/, '')}` : t)

/** Big mic: tap to toggle, or press and hold to talk and release to send. */
function MicOrb({
  on,
  supported,
  toggle,
  size,
  interim,
  onBack,
  handsFree,
}: {
  on: boolean
  supported: boolean
  toggle: () => void
  size: number
  interim?: string
  onBack?: () => void
  /** Right of the orb: turn hands-free "Hi {pal}" on or off. awake: it heard "Hi {pal}" and is taking the request */
  handsFree?: { on: boolean; palName: string; awake?: boolean; thinking?: boolean; heard?: string }
}) {
  // The mic is open, by tap or by "Hi {pal}": same rings either way, so you can tell it's listening
  const live = on || !!handsFree?.awake
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
    ? 'Voice needs a microphone'
    : held
    ? 'Release to send'
    : on
    ? (interim && latest(interim)) || 'Listening… tap to stop'
    : handsFree?.heard
    ? `“${latest(handsFree.heard)}”`
    : handsFree?.awake
    ? "I'm listening… go ahead"
    : handsFree?.thinking
    ? 'Got it…'
    : handsFree?.on
    ? `Hands-free: just say "Hi ${handsFree.palName}"`
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
          className={`relative grid touch-none place-items-center rounded-full text-white transition-transform duration-200 [transition-timing-function:var(--ease-out)] select-none [-webkit-touch-callout:none] ${supported ? 'bg-accent shadow-[0_14px_30px_-10px_var(--accent)]' : 'bg-ink/25'} ${held ? 'scale-110' : 'active:scale-95'}`}
          aria-label={label}
          aria-pressed={live}
        >
          {live && (
            <>
              <span className="ring absolute inset-0 rounded-full bg-accent" />
              <span className="ring ring-2 absolute inset-0 rounded-full bg-accent" />
            </>
          )}
          {!live && handsFree?.thinking && (
            <span className="ring absolute inset-0 rounded-full bg-accent/60 animate-pulse" />
          )}
          <Mic className={`relative ${size > 70 ? 'size-8' : 'size-6'}`} />
        </button>
      </div>
      <span className={`line-clamp-2 max-w-[300px] text-center text-[12px] font-medium ${live || handsFree?.heard || handsFree?.thinking ? 'text-accent' : 'text-ink-3'}`}>
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
      className={`press h-9 rounded-full px-4 text-[13.5px] font-medium ${primary ? 'bg-accent text-white shadow-[0_6px_14px_-8px_var(--accent)]' : 'text-ink-2 hover-lift hover:text-ink'}`}
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
            <span key={i} className={`rounded-full px-3 py-1.5 text-[13.5px] ${i === 0 ? 'bg-accent-soft font-semibold text-ink' : 'bg-ink/[0.05] text-ink-2'}`}>{t}</span>
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
              className={`chip-in flex h-10 items-center gap-3 rounded-full pr-4 pl-1.5 text-[13.5px] transition-colors duration-300 ${b.status === 'proposed' ? 'bg-accent-soft' : 'bg-ink/[0.04]'}`}
            >
              <span className={`grid size-7 place-items-center rounded-full text-[11px] font-semibold tnum ${b.status === 'proposed' ? 'bg-paper/80 text-accent' : 'bg-paper/80 text-ink-2'}`}>{i + 1}</span>
              <span className="w-[78px] shrink-0 text-ink-2">{fmtDay(b.start).replace(/,.*/, '')}</span>
              <span className="tnum font-medium">{fmtTime(b.start)} – {fmtTime(b.end)}</span>
              <span className="tnum ml-auto text-[12px] text-ink-3">{fmtHours((b.end - b.start) / 3_600_000)}</span>
            </li>
          ))}
          {!blocks.length && <li className="text-[13.5px] text-ink-3">{c.blockIds.length ? 'These times were replaced by a newer plan.' : 'No blocks fit before the deadline.'}</li>}
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
        {!done && c.replaces?.length ? (
          <p className="mt-2 text-[13px] leading-snug text-ink-2">Your current {c.replaces.length > 1 ? `${c.replaces.length} blocks stay` : 'block stays'} until you accept.</p>
        ) : null}
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

  if (c.type === 'file') {
    return (
      <div className={wrap}>
        <div className="inline-flex min-h-10 max-w-full items-center gap-2.5 rounded-full bg-ink/[0.04] pr-4 pl-3 text-[13.5px]">
          <Clip className="size-4 shrink-0 text-ink-2" />
          <span className="truncate font-semibold">{c.name}</span>
          {c.folderName.toLowerCase() !== c.name.toLowerCase() && <span className="shrink-0 text-ink-2">{c.folderName}</span>}
        </div>
        {!c.scanned && (
          <>
            {/* The question Pal just asked: a schedule to pull dates from, or study material */}
            <div className="mt-2.5 -ml-1 flex flex-wrap gap-1">
              <Btn primary={(c.dates ?? 0) >= 2} onClick={() => onCard(m.id, 'schedule')}><span className="inline-flex items-center gap-1.5"><Calendar className="size-3.5" /> Add its dates{c.dates ? ` (${c.dates})` : ''}</span></Btn>
              <Btn primary={(c.dates ?? 0) < 2} onClick={() => onCard(m.id, 'study')}><span className="inline-flex items-center gap-1.5"><Cards className="size-3.5" /> Flashcards & quiz</span></Btn>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-1 text-[12.5px] text-ink-3">
              <button type="button" onClick={() => onCard(m.id, 'plan')} className="press inline-flex items-center gap-1 hover:text-ink"><Calendar className="size-3" /> Plan study time</button>
              <button type="button" onClick={() => onCard(m.id, 'quiz')} className="press inline-flex items-center gap-1 hover:text-ink"><Quiz className="size-3" /> Quiz me now</button>
              <button type="button" onClick={() => onCard(m.id, 'read')} className="press inline-flex items-center gap-1 hover:text-ink"><Speaker className="size-3" /> Read aloud</button>
            </div>
          </>
        )}
        {c.scanned && <div className="mt-2.5 -ml-1"><Btn onClick={() => onCard(m.id, 'read')}>Open it</Btn></div>}
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
            {c.days?.length && c.until ? ` · until ${fmtDay(c.until).replace(/^\w+, /, '')}` : ''}
          </span>
        </div>
        {c.clash?.length ? (
          <p className="mt-2.5 text-[13.5px] leading-snug text-amber">
            Overlaps {c.clash.join(' and ')}.{c.alt ? ` ${fmtTime(c.alt.start)}–${fmtTime(c.alt.end)} is free.` : ''}
          </p>
        ) : c.conflicts > 0 && (
          <p className="mt-2.5 text-[13.5px] leading-snug text-amber">
            {c.blocked?.length ? `This overlaps your study block ${c.blocked.join(' and ')}${c.conflicts > c.blocked.length ? ` and ${c.conflicts - c.blocked.length} more` : ''}.` : `This overlaps ${c.conflicts} planned block${c.conflicts > 1 ? 's' : ''}.`} I can suggest new times for {c.conflicts > 1 ? 'them' : 'it'} if you add it.
          </p>
        )}
        {done ? <Done t={done} /> : (
          <div className="mt-2.5 -ml-1 flex flex-wrap gap-1">
            {c.moveOther && <Btn primary onClick={() => onCard(m.id, 'moveOther')}>{c.moveOther.trimmed ? `Shorten ${c.moveOther.title} to ${fmtTime(c.moveOther.to.start)}–${fmtTime(c.moveOther.to.end)}` : `Move ${c.moveOther.title} to ${fmtTime(c.moveOther.to.start)}`}</Btn>}
            {c.alt && <Btn primary onClick={() => onCard(m.id, 'useAlt')}>Use {fmtTime(c.alt.start)}</Btn>}
            <Btn primary={!c.alt && !c.moveOther} onClick={() => onCard(m.id, 'addEvent')}>{c.clash?.length ? 'Add anyway' : c.conflicts ? 'Add and re-plan' : 'Add it'}</Btn>
            <Btn onClick={() => onCard(m.id, 'skipEvent')}>Never mind</Btn>
          </div>
        )}
      </div>
    )
  }

  if (c.type === 'change') {
    const G = Glyph[(c.kind as keyof typeof Glyph) ?? 'shift'] ?? Glyph.shift
    const when = (s: number, e: number) => `${fmtDay(s).replace(/,.*/, '')} · ${fmtTime(s)} – ${fmtTime(e)}`
    const removing = c.mode === 'remove'
    return (
      <div className={wrap}>
        <div className="inline-flex min-h-10 flex-wrap items-center gap-2.5 rounded-full bg-ink/[0.04] pr-4 pl-3 text-[13.5px]">
          <G className="size-4 text-ink-2" />
          <span className={`font-semibold ${removing ? 'text-ink-2 line-through decoration-ink-3/60' : ''}`}>{c.title}</span>
          <span className={`tnum text-ink-2 ${c.to ? 'line-through decoration-ink-3/60' : ''}`}>{when(c.start, c.end)}</span>
          {c.to && <span className="tnum font-medium">→ {when(c.to.start, c.to.end)}</span>}
        </div>
        {c.targets && <ul className="mt-2 space-y-1 text-[13px] text-ink-2">{c.targets.map((target) => <li key={target.id}>{target.title} · {when(target.start, target.end)}</li>)}</ul>}
        {c.clash?.length ? <p className="mt-2.5 text-[13.5px] leading-snug text-amber">The new time overlaps {c.clash.join(' and ')}.</p> : null}
        {done ? <Done t={done} /> : (
          <div className="mt-2.5 -ml-1 flex flex-wrap gap-1">
            <Btn primary onClick={() => onCard(m.id, 'apply')}>{removing ? (c.targets ? `Remove ${c.targets.length} blocks` : c.seriesIds ? 'Remove this one' : 'Remove') : 'Move it'}</Btn>
            {removing && c.seriesIds && <Btn onClick={() => onCard(m.id, 'removeAll')}>Remove all {c.seriesIds.length}</Btn>}
            <Btn onClick={() => onCard(m.id, 'keep')}>Keep it</Btn>
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
            <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-accent" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}
