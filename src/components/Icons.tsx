import type { Kind } from '../lib/core'

type P = { className?: string }
const S = ({ className = 'size-4', children }: P & { children: React.ReactNode }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
)

export const ChevronL = (p: P) => <S {...p}><path d="M10 3.5 5.5 8l4.5 4.5" /></S>
export const ChevronR = (p: P) => <S {...p}><path d="M6 3.5 10.5 8 6 12.5" /></S>
export const Mic = (p: P) => <S {...p}><rect x="5.5" y="1.75" width="5" height="8" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" /></S>
export const Send = (p: P) => <S {...p}><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></S>
export const Gear = (p: P) => <S {...p}><path d="M2 4.5h7M12.5 4.5H14M2 11.5h2M7.5 11.5H14" /><circle cx="10.75" cy="4.5" r="1.75" /><circle cx="5.75" cy="11.5" r="1.75" /></S>
export const Clock = (p: P) => <S {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></S>
export const Doc = (p: P) => <S {...p}><path d="M4 1.75h5.5L12 4.25v10H4z" /><path d="M6 7.5h4M6 10h4" /></S>
export const Speaker = (p: P) => <S {...p}><path d="M2.5 6v4h2.5l3.5 3V3L5 6z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5" /></S>
export const SpeakerOff = (p: P) => <S {...p}><path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11 6l3 4M14 6l-3 4" /></S>
export const Check = (p: P) => <S {...p}><path d="m3.5 8.5 3 3 6-7" /></S>
export const X = (p: P) => <S {...p}><path d="m4 4 8 8M12 4l-8 8" /></S>
export const HomeIcon = (p: P) => <S {...p}><path d="M2.5 7.5 8 3l5.5 4.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" /><path d="M6.5 14v-3.5h3V14" /></S>
export const WeekIcon = (p: P) => <S {...p}><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.75v2.5M10.5 1.75v2.5M5 9.5h1M7.5 9.5h1M10 9.5h1M5 11.75h1M7.5 11.75h1" /></S>
export const TasksIcon = (p: P) => <S {...p}><path d="m2.5 4 1.25 1.25L6 3M2.5 9.5l1.25 1.25L6 8.5M8.5 4.25H14M8.5 9.75H14M8.5 13.5H12" /></S>
export const Sparkle = (p: P) => <S {...p}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.5 1.5M10.5 10.5 12 12M4 12l1.5-1.5M10.5 5.5 12 4" /></S>

// Event-type glyphs, same 1.5px line weight
export const Glyph: Record<Kind, (p: P) => React.ReactElement> = {
  class: (p) => <S {...p}><path d="M2 3.5c2-.8 4-.8 6 .5 2-1.3 4-1.3 6-.5v9c-2-.8-4-.8-6 .5-2-1.3-4-1.3-6-.5z" /><path d="M8 4v9" /></S>,
  shift: (p) => <S {...p}><rect x="2" y="5" width="12" height="8.5" rx="1.5" /><path d="M5.5 5V3.5h5V5" /></S>,
  exam: (p) => <S {...p}><path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5" /></S>,
  work: (p) => <S {...p}><path d="m10.5 2.5 3 3-7.5 7.5H3v-3z" /></S>,
  commute: (p) => <S {...p}><rect x="3" y="2" width="10" height="10" rx="2" /><path d="M3 8h10M5.5 12v2M10.5 12v2" /></S>,
  protected: (p) => <S {...p}><rect x="3.5" y="7" width="9" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></S>,
  deadline: (p) => <S {...p}><path d="M8 14.5s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0c0 3.5 4.5 7.5 4.5 7.5z" /><circle cx="8" cy="7" r="1.5" /></S>,
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[3px] leading-none select-none ${className}`} aria-label="Pal.Do">
      <span className="font-serif text-[1.55em] tracking-[-0.02em]">Pal</span>
      <span className="mb-[0.08em] inline-block size-[0.32em] rounded-[0.09em] bg-tangerine" />
      <span className="font-sans text-[1.05em] font-semibold tracking-[-0.03em]">Do</span>
    </span>
  )
}

/** Line illustration: syllabus page whose highlighted lines drop into calendar ticks. */
export function SyllabusArt({ className = '' }: P) {
  return (
    <svg viewBox="0 0 160 96" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className} aria-hidden>
      <path d="M18 10h44l12 12v64H18z" />
      <path d="M62 10v12h12" />
      <path d="M28 34h34M28 44h24M28 54h30M28 64h20M28 74h28" opacity=".45" />
      <rect x="26" y="40" width="28" height="8" rx="1" fill="var(--tangerine)" stroke="none" opacity=".35" />
      <rect x="26" y="60" width="24" height="8" rx="1" fill="var(--tangerine)" stroke="none" opacity=".35" />
      <path d="M82 44c10 0 14-6 22-6M82 64c12 0 16 8 24 8" strokeDasharray="2 4" />
      <rect x="108" y="22" width="40" height="58" rx="4" />
      <path d="M108 34h40M121 34v46M134 34v46M108 50h40M108 65h40" opacity=".35" />
      <rect x="123" y="37" width="9" height="10" rx="1.5" fill="var(--tangerine)" stroke="none" />
      <rect x="136" y="68" width="9" height="10" rx="1.5" fill="var(--tangerine)" stroke="none" />
    </svg>
  )
}
export const Sun = (p: P) => <S {...p}><circle cx="8" cy="8" r="2.75" /><path d="M8 1.25v1.5M8 13.25v1.5M1.25 8h1.5M13.25 8h1.5M3.2 3.2l1.05 1.05M11.75 11.75l1.05 1.05M3.2 12.8l1.05-1.05M11.75 4.25l1.05-1.05" /></S>
export const Moon = (p: P) => <S {...p}><path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z" /></S>
export const Trash = (p: P) => <S {...p}><path d="M2.5 4.5h11M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4 4.5l.6 8.5a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.5M6.75 7v4M9.25 7v4" /></S>
/** Hands-free: sound waves */
export const Waves = (p: P) => <S {...p}><path d="M2 8h.01M4.75 6v4M7.5 3.5v9M10.25 5.5v5M13 7v2" /></S>
export const TimerIcon = (p: P) => <S {...p}><circle cx="8" cy="9" r="5.25" /><path d="M8 9V6.5M6.5 1.75h3M8 1.75v2" /></S>
export const Clip = (p: P) => <S {...p}><path d="M12.5 7.25 7.6 12.15a3 3 0 0 1-4.25-4.25l5.3-5.3a2 2 0 0 1 2.83 2.83L6.2 10.7a1 1 0 0 1-1.42-1.41L9.5 4.6" /></S>
export const Plus = (p: P) => <S {...p}><path d="M8 3v10M3 8h10" /></S>
export const Play = (p: P) => <S {...p}><path d="M5 3.25v9.5L12.5 8z" /></S>
export const Pause = (p: P) => <S {...p}><path d="M5.5 3.5v9M10.5 3.5v9" /></S>
export const Cards = (p: P) => <S {...p}><rect x="2" y="4.5" width="9" height="9" rx="1.5" /><path d="M5 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v7.5" /></S>
export const Quiz = (p: P) => <S {...p}><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3M8 11.2v.05" /></S>
export const Calendar = (p: P) => <S {...p}><rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" /><path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3" /></S>
export const ChevronD = (p: P) => <S {...p}><path d="M3.5 6 8 10.5 12.5 6" /></S>
