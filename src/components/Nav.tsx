import { Doc, Gear, Moon, Sun, HomeIcon, TasksIcon, TimerIcon, WeekIcon } from './Icons'

export type View = 'home' | 'week' | 'tasks' | 'study'
const ITEMS: { id: View; label: string; Icon: (p: { className?: string }) => React.ReactElement }[] = [
  { id: 'home', label: 'Today', Icon: HomeIcon },
  { id: 'week', label: 'Week', Icon: WeekIcon },
  { id: 'tasks', label: 'Tasks', Icon: TasksIcon },
  { id: 'study', label: 'Study', Icon: TimerIcon },
]

interface Props {
  view: View
  setView: (v: View) => void
  onSyllabus: () => void
  onSettings: () => void
  dark?: boolean
  onTheme?: () => void
  taskCount: number
  /** A Study session is running: show a dot on the Study item */
  studying?: boolean
}

/** Desktop: a slim glass rail. The active pill slides between items instead of jumping. */
export function Rail({ view, setView, onSyllabus, onSettings, taskCount, dark, onTheme, studying }: Props) {
  const i = ITEMS.findIndex((x) => x.id === view)
  return (
    <nav className="liquid relative z-30 flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-[30px] py-4" aria-label="Views">
      <div className="mb-4 grid size-10 place-items-center" aria-hidden>
        <span className="size-3 rounded-[4px] bg-tangerine shadow-[0_4px_12px_-3px_var(--tangerine)]" />
      </div>
      <div className="relative flex flex-col gap-1">
        <span
          className="absolute left-0 top-0 h-[60px] w-[52px] rounded-[18px] bg-paper shadow-[0_4px_14px_-6px_rgb(45_42_66/0.18)] transition-transform duration-[380ms] [transition-timing-function:var(--ease-drawer)]"
          style={{ transform: `translateY(${i * 64}px)` }}
          aria-hidden
        />
        {ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
            className={`press relative flex h-[60px] w-[52px] flex-col items-center justify-center gap-1 rounded-[18px] text-[10.5px] font-medium transition-colors duration-200 ${view === id ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}
          >
            <Icon className="size-[18px]" />
            {label}
            {id === 'tasks' && taskCount > 0 && <span className="tnum absolute top-2 right-2 grid h-4 min-w-4 place-items-center rounded-full bg-tangerine px-1 text-[9.5px] font-semibold text-white">{taskCount}</span>}
            {id === 'study' && studying && <span className="pulse-dot absolute top-2 right-2 size-2 rounded-full bg-tangerine" aria-label="Session running" />}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <button onClick={onSyllabus} className="press grid size-11 place-items-center rounded-full text-ink-2 hover-lift" aria-label="Paste a syllabus" title="Paste a syllabus"><Doc className="size-[18px]" /></button>
      <button onClick={onTheme} className="press grid size-11 place-items-center rounded-full text-ink-2 hover-lift" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>{dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}</button>
      <button onClick={onSettings} className="press grid size-11 place-items-center rounded-full text-ink-2 hover-lift" aria-label="Pal and preferences" title="Pal and preferences"><Gear className="size-[18px]" /></button>
    </nav>
  )
}

/** Mobile: bottom tab bar, same sliding pill. */
export function TabBar({ view, setView, taskCount, studying }: Pick<Props, 'view' | 'setView' | 'taskCount' | 'studying'>) {
  const i = ITEMS.findIndex((x) => x.id === view)
  return (
    <nav className="liquid relative grid grid-cols-4 rounded-full p-1" aria-label="Views">
      <span
        className="absolute inset-y-1 left-1 w-[calc((100%-8px)/4)] rounded-full bg-paper shadow-[0_4px_14px_-6px_rgb(45_42_66/0.18)] transition-transform duration-[380ms] [transition-timing-function:var(--ease-drawer)]"
        style={{ transform: `translateX(${i * 100}%)` }}
        aria-hidden
      />
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          onClick={() => setView(id)}
          aria-current={view === id ? 'page' : undefined}
          className={`press relative flex h-11 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors duration-200 ${view === id ? 'text-ink' : 'text-ink-3'}`}
        >
          <Icon className="size-4 max-[380px]:hidden" />
          {label}
          {id === 'tasks' && taskCount > 0 && <span className="tnum grid h-4 min-w-4 place-items-center rounded-full bg-tangerine px-1 text-[9.5px] font-semibold text-white">{taskCount}</span>}
          {id === 'study' && studying && <span className="pulse-dot size-2 rounded-full bg-tangerine" aria-label="Session running" />}
        </button>
      ))}
    </nav>
  )
}
