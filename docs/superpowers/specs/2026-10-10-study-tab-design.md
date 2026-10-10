# Study tab: design spec

**Date:** 2026-10-10 · **Status:** awaiting review · **Niche:** Filipino working students (classes, part-time shifts, long commutes)

## Goal
Give students a simple, reliable Pomodoro timer inside pal.do. It's the first study tool, and later phases (block-linked sessions, commute flashcards) build on it.

## Scope
**In scope:**
- A new **Study** tab.
- A fixed **25-min focus / 5-min break** cycle, with a **15-min long break after every 4th round**.
- Start / Pause / Resume / Skip / Stop.
- Phase-end **alarms** (Android native notification, web notification + chime).
- A per-day **focus-minutes total**.
- Pal shown as a companion.

**Out of scope (deferred):**
- linking a session to a planned calendar block, and the check-in/reflow afterwards;
- rounds that fit the free gap;
- chat intents ("start pomodoro");
- the post-shift "pagod" input;
- flashcards and quizzes;
- streaks.

## Guardrails
- The timer never comments on the student's state ("you seem tired") and never pressures. No streaks or leaderboards in this slice.
- The focus total is private and only shown as a neutral number ("Today: 50 min focused").

## Design

### 1. Navigation (`src/components/Nav.tsx`, `src/components/Icons.tsx`, `src/App.tsx`)
- `View` becomes `'home' | 'week' | 'tasks' | 'study'`. `ITEMS` gets `{ id: 'study', label: 'Study', Icon: TimerIcon }`.
- In `TabBar`, `grid-cols-3` becomes `grid-cols-4` and the pill width goes from `(100%-8px)/3` to `/4`. The `Rail` pill already uses the item index.
- New `TimerIcon` in the existing 16×16, 1.5-stroke `S` wrapper style.
- A small tangerine dot on the Study item while a session is running (phase ≠ `idle`).
- `content` in `App.tsx` renders `<Study …/>` when `view === 'study'`.

### 2. Timer model (new `src/lib/session.ts`, pure TypeScript, no React)
```ts
type Phase = 'idle' | 'focus' | 'break'
interface Session {
  phase: Phase
  round: number            // 1-based focus round in the current cycle
  phaseEndsAt: number      // epoch ms; meaningless when idle or paused
  pausedLeft?: number      // ms left when paused; undefined = running
  completedFocusMs: number // focus time finished today (for the log)
}
```
- Constants: `FOCUS = 25 min`, `BREAK = 5 min`, `LONG_BREAK = 15 min`, `LONG_EVERY = 4`.
- Functions return a new Session and never mutate:
  - `start(now)`
  - `pause(s, now)`
  - `resume(s, now)`
  - `skip(s, now)`
  - `stop()`
  - `tick(s, now)`
  - `remaining(s, now)`
- **`tick` is timestamp-driven.** While `now >= phaseEndsAt` it advances phase by phase, accumulating focus time. A phone that slept for two hours lands in the correct phase instead of counting interval ticks, because mobile WebViews freeze `setInterval` in the background.
- The UI re-renders on a 1-second interval only to display time. Correctness never depends on it.

### 3. Persistence (`src/App.tsx`)
- `Saved` gains `session?: Session` and `focusLog?: Record<string, number>` (date string → focus minutes). It's saved with the existing `paldo-v1` write.
- On load, `tick(session, Date.now())` reconciles any time that passed while the app was closed.

### 4. UI (new `src/components/Study.tsx`)
- Large countdown in tabular numerals, the phase label ("Focus" / "Break" / "Long break"), and 4 round dots.
- Buttons:
  - idle: **Start**;
  - running: **Pause**, **Skip**;
  - paused: **Resume**, **Stop**.
- The active pal at about 120px, using the existing `Pal` component:
  - focus → `idle` (calm);
  - break → `happy`;
  - a completed round → a brief `cheer`.
- Footer: "Today: N min focused".
- Pal lines come from new `BASE`/`VOICE` keys in `src/lib/agent.ts` (`sessionStart`, `breakStart`, `focusStart`, `sessionDone`) and appear in the speech bubble.
- Follows the existing design tokens (`liquid`, `press`, `tnum`, tangerine accent). It must work at 375px width and in dark mode.

### 5. Alarms (`src/lib/notifications.ts`)
- **Required fix:** `syncEventAlarms` currently cancels **every** pending notification. Change it to cancel only notifications whose id is not `SESSION_ALARM_ID`. Without this, any calendar change silently deletes the timer's alarm.
- New:
  - `scheduleSessionAlarm(at: number, title: string, body: string)`: Android `LocalNotifications` with `id = SESSION_ALARM_ID (900001)`. On web, a `setTimeout`-free check: the 1-second UI tick fires the Web Notification when it crosses `phaseEndsAt`, if permission is granted.
  - `cancelSessionAlarm()`
- Reschedule on start, resume, skip and each phase change. Cancel on pause and stop.
- In-app: a short chime (WebAudio oscillator, no asset) when a phase ends while the app is open. During quiet hours (`isQuiet`), the chime is muted but the visual change stays.

### 6. Focus log
- When `tick` completes a focus phase, add its minutes to `focusLog[todayKey]`. Pausing doesn't count paused time, and skipping a focus phase early counts only the elapsed focus time.

## Error handling
- Notification permission denied: the timer still works, and the in-app chime and visual are the fallback. A one-line hint offers to enable alarms.
- Corrupt or missing `session` in the save: treat it as idle.
- A clock change or negative remaining time: clamp at 0 and let `tick` advance.

## Testing
- `src/lib/session.test-cases.ts` (run by `pnpm eval:chat` alongside the conversation cases):
  - start → focus with 25:00 remaining;
  - focus end → break 5:00; after round 4 → long break 15:00;
  - a 2-hour jump from round 1 focus lands in the correct phase and round, with focus minutes counted;
  - pause → remaining frozen; resume → the end time shifts by the paused duration;
  - skip from focus logs only the elapsed time;
  - stop → idle.
- `npx tsc --noEmit` is clean, and the rules eval stays green.
- Playwright:
  - start, reload mid-round, and the countdown resumes correctly;
  - skip to a break, and the label and Pal state change.
- Android, manual:
  - background the app, and the phase-end notification fires;
  - add a calendar event mid-session, and the alarm still fires (verifies the sync fix).
