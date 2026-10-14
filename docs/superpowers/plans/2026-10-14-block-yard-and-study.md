# Block Yard and Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Do not start the larger redesign as a side effect of unrelated bug fixes.

**Goal:** Add manual task creation, editing and notes; replace Tasks with Block Yard; simplify Focus and unify Cards while preserving the user's existing visual design and data.

**Architecture:** Extend the existing saved task records and use stable task/event links, with pure migration and synchronization functions shared by manual editing and chat. Keep folder/file/deck storage in IndexedDB. Extract focused task and card components rather than growing App.tsx further.

**Tech Stack:** React 19, TypeScript 5.7, Vite 8, Tailwind CSS 4, existing SVGs, localStorage, IndexedDB. Prefer existing/native APIs; add no dependency without a concrete need.

**Spec:** [Approved direction and proposed implementation defaults](../specs/2026-10-14-block-yard-and-study-design.md).

## Global constraints

- Block Yard replaces Tasks; Focus and Cards stay under Study.
- Preserve existing folder tabs, layered paper, SVG instruments, typography, Pals, and light/dark themes.
- Preserve Pomodoro's illustration, timer controls, explicit Start, and current round/break behavior; remove its goal question.
- A title is sufficient to create an unscheduled task. Notes are multiline plain text.
- Deadline, estimated duration, scheduled time, task completion, and study hours have distinct meanings.
- Core task, board, timer and card operations work offline; chat/AI is not required for manual edits.
- Preserve old task IDs, calendar event IDs, folders, files, decks, and active sessions. No data reset.
- Three active Workbench tasks maximum; every drag action has a button/keyboard equivalent.
- Defer sticky-note themes, AI artwork, sync, and Pomodoro brain dump.
- Implementation completed in the current feature checkout. See the execution ledger for verification and device-testing limits.

## Review focus

1. A legacy task with missing new fields or partial completed hours must migrate without disappearing or losing study progress (Task 1).
2. A repeated Save, calendar edit, or concurrent chat change must not duplicate task blocks or overwrite unrelated events (Task 3).
3. A fourth Workbench task, reopening a completed task, or touch drag cancellation must preserve board limits and data (Task 4).
4. A regenerated deck with reused card IDs must not receive an older answer's learning history (Task 6).
5. Long task notes/titles, small landscape windows, keyboard navigation, and reload during an active session must remain usable (Tasks 2, 5, 7).

## File boundaries

- `src/lib/core.ts`: existing Task/CalEvent types; extend task kind with `task` and make task deadline optional.
- `src/lib/tasks.ts` (new): task normalization, validation, updates, status transitions, and calendar synchronization.
- `src/components/TaskEditor.tsx` (new): accessible task creation/detail UI, explicit Save, unsaved draft handling.
- `src/components/Tasks.tsx`: becomes the Block Yard board; retains the existing view identity to preserve saved navigation.
- `src/App.tsx`: load/save migration and callback wiring. Audit direct task mutations so chat and manual editing share task rules.
- `src/lib/task-state.test-cases.ts` and `scripts/check-tasks.mjs` (new): pure task/calendar regression suite using the existing Vite SSR test pattern.
- `src/components/Study.tsx`, `StudyTools.tsx`: Focus entry and direct Pomodoro opening; keep old running-session rendering.
- `src/components/Library.tsx`: preserve folder/file browsing; delegate deck practice to a focused component.
- `src/components/CardPractice.tsx`, `src/lib/card-practice.ts` (new): unified deck practice UI, queue and progress rules.
- `src/lib/library.ts`: additive IndexedDB progress store migration, without deleting existing stores.
- `src/components/Today.tsx`, `Nav.tsx`, `src/index.css`: labels, shortcuts, existing visual tokens and responsive composition.

## Task 1 — A compatible task model

**Interfaces:** `normalizeTask(raw: unknown, now: number): Task | null`, `isTaskDone(task: Task): boolean`, `validateTaskDraft(draft: TaskDraft): string[]`, `applyTaskEdit(task: Task, draft: TaskDraft, now: number): Task` in `src/lib/tasks.ts`.

Extend Task with `notes: string`, `status: 'pile' | 'doing' | 'done'`, optional `due`, `estimatedMinutes`, `scheduled: { eventId: string; start: number; end: number }`, `folderId`, `completedAt`, and creation/update/activity timestamps. Keep `hours` and `doneHours` for study compatibility; general tasks may have zero estimated study hours. TaskDraft is an explicit editable subset of those fields. Legacy tasks infer completion from their existing progress only during normalization.

- [x] Add failing fixtures for legacy exam/assignment tasks, partially completed work, malformed records, title-only tasks, and notes surviving a JSON round trip.
- [x] Run `node scripts/check-tasks.mjs`; confirm the new behavior fails before implementation.
- [x] Implement normalization and immutable edits. Preserve IDs and known optional data; surface invalid records rather than silently resetting a save.
- [x] Normalize tasks when reading `paldo-v1`. Audit all `due`, `hours`, and completion assumptions in App, schedule, context, conversation, agent, Today, Tasks, Library and StudyTools. Unscheduled tasks must not produce invalid dates or enter a deadline planner without a deadline.
- [x] Run `node scripts/check-tasks.mjs`, `pnpm eval:chat`, and `pnpm exec tsc --noEmit`; require zero failures.

## Task 2 — Manual creation, editing and notes

**Interfaces:** TaskEditor receives `task: Task | null`, `folders: Folder[]`, `onSave(draft: TaskDraft): void`, and `onClose(): void`; Tasks receives `onCreate(): void`, `onEdit(taskId: string): void` alongside its existing scheduling callbacks.

- [x] Write browser regressions for quick-add without AI, editing an existing title, multiline notes, optional dates/duration, Cancel, unsaved-close handling, and persistence after reload.
- [x] Observe failing tests through the existing dev server.
- [x] Add New task and title-only quick-add. Build a desktop detail panel and a mobile full-screen editor using existing folder/paper tokens. Use real labels, visible Save/Cancel, and keyboard-safe scrolling.
- [x] Commit task edits through Task 1 helpers. Save only the selected task; do not recreate it or discard unrelated task changes.
- [x] Verify 320/390/768/1024/1440 px layouts, short landscape, keyboard use, very long notes, and offline/reload behavior; run `node scripts/check-tasks.mjs` and TypeScript.

## Task 3 — One task-owned calendar block

**Interfaces:** `syncTaskCalendar(before: Task | null, after: Task, events: CalEvent[]): CalEvent[]` in tasks.ts; use stable `scheduled.eventId` to distinguish this block from existing study sessions and deadline markers.

- [x] Add failing assertions: unscheduled task creates no work block; schedule creates exactly one; repeated Save is idempotent; moving/renaming updates that block; removing schedule removes only that block; completion/reopening updates its status; unrelated events and old study blocks are unchanged.
- [x] Implement synchronization and route manual task saves through one transaction over the latest task/event snapshots.
- [x] Preserve deadline markers separately. Validate end after start and show conflicts before applying an overlapping schedule. Never silently replace a changed calendar entry.
- [x] Add a stale-preview regression where chat changes the calendar while an editor is open.
- [x] Run task regressions and `pnpm eval:chat`; require all previous schedule tests to pass.

## Task 4 — Block Yard board

**Interfaces:** `transitionTask(task: Task, status: Task['status'], tasks: Task[], now: number): { task?: Task; error?: string }` in tasks.ts. Board actions consume that result; dragging and buttons use the same transition.

- [x] Add failing tests for three active slots, refusing a fourth, completing/reopening, activity timestamps, cooling without status mutation, and completion history grouped by date.
- [x] Replace Tasks content with Pile, Workbench and Done. Preserve its saved `tasks` view key. Reuse folder/paper surfaces and SVG symbols; readable block sizing is clamped to the board's available width.
- [x] Implement pointer drag with vertical scrolling preserved and cancellation leaving data unchanged; provide explicit Move/Complete/Reopen actions and keyboard focus restoration.
- [x] Use three columns on desktop, reflow on tablets, and zone tabs on phones. Implement the proposed 30-minute cooling indication as display state only.
- [x] Verify board limits, reload, offline operation, reduced motion, keyboard actions and synthesized touch dragging. Report physical-device gaps.

## Task 5 — Direct Pomodoro, no goal questionnaire

**Interfaces:** existing `onConfigure(config: StudyConfig)` and session configuration remain authoritative; selected folder ID/name can be included, goal is omitted for newly opened Pomodoros.

- [x] Change the UI regression to require selecting Pomodoro to reveal the current ready timer with Start and no goal input or intermediate Open timer form. Confirm the old behavior fails that test.
- [x] Bypass Pomodoro ToolSetup. Preserve its SVG, round/break logic and explicit Start; leave the user’s existing running or paused session untouched.
- [x] Replace the six-method primary gallery with Focus/Cards entry points, while retaining a compatibility renderer for saved sessions using older methods.
- [x] Run `node scripts/check-study-ui.mjs`, session regressions via `pnpm eval:chat`, and browser reload tests for ready/running/paused sessions.

## Task 6 — One deck, three practice modes

**Interfaces:** `CardMode = 'swipe' | 'recall' | 'quiz'`; `cardProgressKey(fileId: string, card: Flashcard): string` includes content identity; `recordCardResult(key: string, mode: CardMode, correct: boolean, now: number): Promise<CardProgress>` persists shared progress in library.ts. CardProgress stores total attempts/correct, lastReviewedAt, and per-mode attempts/correct counts. card-practice.ts owns bounded session queues and quiz choices from the selected deck.

- [x] Add failing regressions for shared progress across modes, missed cards appearing sooner, one extra repetition per card/mode, completion of a full round, reload persistence, reused IDs with changed content, and decks with too few distinct answers for a quiz.
- [x] Add an IndexedDB progress store through an additive version migration. Existing folder, file, deck and quiz stores remain intact.
- [x] Build CardPractice with Swipe/Recall/Quiz tabs, flip/reveal, typed recall with self-marking, and explicit know/not-yet buttons. Gestures supplement buttons. Optional Full round advances through the three modes.
- [x] Replace separate practice entry points in Library while keeping files/reading/import and the current folder artwork. Reuse saved decks; do not require another AI call to switch modes.
- [x] Run new card tests, `node scripts/check-study-tools.mjs`, study/library regressions through `pnpm eval:chat`, and offline browser persistence checks.

## Task 7 — Navigation and responsive finishing

- [x] Add browser assertions that Tasks opens Block Yard; Study exposes Focus and Cards; Today shortcuts reach the same canonical destinations; existing folder and calendar links still resolve.
- [x] Wire the final labels and shortcuts without duplicate task collections or a second independent calendar. Keep the current Pal chat and existing responsive app shell.
- [x] Verify empty, populated, completed, saving, invalid-input, conflict, missing-folder, and loading states. Check light/dark, 320–1920 px widths, short windows, long titles/notes, keyboard focus, and reduced motion.
- [x] Run `pnpm eval:chat`, task/card suites, `node scripts/check-study-ui.mjs`, `node scripts/check-adaptive-ui.mjs` with Playwright configured, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check`. Update intentional navigation assertions in UI fixtures while retaining overflow checks.
- [x] Review the exact phase diff before a selective commit. Do not include unrelated work already present in this checkout; do not deploy or reset data as part of this plan.

## Implementation handoff

Executed in the approved order. The 30-minute cooling threshold and bounded missed-card queue are implemented. Verification results, review fixes, and integration rulings are recorded in [the execution ledger](2026-10-14-block-yard-progress.md).
