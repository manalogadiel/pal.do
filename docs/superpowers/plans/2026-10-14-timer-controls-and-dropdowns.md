# Timer Controls and Dropdown Consistency Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes. Implementation authorized by the user and completed in this checkout; verification and limits are recorded below.

**Goal:** Make the existing timer techniques work predictably and replace application option dropdowns with one accessible selector that matches Pal.do.

**Architecture:** Repair the current timer configuration path instead of adding another timer system. Introduce one small controlled single-select component and migrate the reachable option selectors to it, preserving their current state, validation, persistence, and callbacks. Retain existing dialogs and the current design tokens.

**Tech stack:** Existing React 19, TypeScript, Tailwind v4, CSS variables, browser APIs, and current assert/Playwright checks. No additional product dependency is planned.

**Spec:** User request dated October 14, 2026, including the Pomodoro screenshot. The requirements and scope below are the implementation contract.

## Perspective and evidence

The timer problem is primarily a configuration mismatch, not evidence that an invisible element covers every button. Styling the strip alone will not fix it. The dropdown problem is separate: the trigger has some application styling, but the expanded `<select>` chooser remains browser/OS controlled. A consistent application popup needs a shared selector, including its keyboard and modal behavior.

Audit basis: current checkout at `e7c71cd`, targeted source inspection, and an isolated Chrome session with synthetic data. Application source was not changed. Browser results:

| Click from a ready timer | Observed result |
| --- | --- |
| 52 / 17 | Correct: 52 / 17, 52:00 |
| Flowtime | Incorrect: returns to Pomodoro, 25:00, idle session |
| 90m Deep | Correct preset: Custom timer, 90:00 |
| Task-based | Incorrect: returns to Pomodoro, 25:00, idle session |
| Pomodoro 25m | Correct: Pomodoro, 25:00 |

While running, the strip is deliberately disabled. While paused, selecting another technique opens the existing keep/finish-current-session dialog. These two behaviors are confirmed and should not be mistaken for missing click handlers. Their feedback needs to be clearer.

## Necessary issues to address

| Priority | Issue | Evidence and consequence |
| --- | --- | --- |
| P1 | Flowtime and Task-based fail to select | `Study.tsx` supplies `focusMinutes: 0`; `session.ts:validateConfig` requires at least one minute for every method. `configure` returns `IDLE`, silently resetting the screen. Browser reproduced both failures. |
| P1 | Invalid configurations silently discard the current selection | Shared configure/start functions return idle for invalid input. UI callers should validate and show an actionable error instead of replacing the current session with an invalid draft. Preserve the existing low-level return contract unless changing it is necessary. |
| P2 | Task-based creates a fake task description | The quick preset supplies `config.goal || 'Focus goal'`, bypassing the existing meaningful task/goal selection path once the duration bug is repaired. Use an actual task/description; Pomodoro must remain goal-free. |
| P2 | Quick presets drop study associations | Preset configurations omit `folderId`, `folderName`, and `taskId`. Ready-session switching can lose the current material/task context. Preserve applicable associations; never invent a replacement task. Source-confirmed, not independently browser-reproduced. |
| P2 | Technique selector has incomplete accessibility semantics | It declares `role="tablist"`, but its buttons lack tab roles/selected state. They change a timer configuration rather than navigate independent panels. Use a labelled group of toggle buttons with `aria-pressed`; keep native Tab/Enter/Space interaction. |
| P2 | Running-state restrictions look like broken controls | Disabled technique buttons have no nearby explanation. Keep the running session protected and explain the restriction. Existing paused-switch confirmation already works. |
| P2 | Dropdown popup visuals are inconsistent | Reachable selectors use native `<select>` across Settings, tasks, schedules, folders, travel and study setup. Styling the closed field does not provide a consistently themed expanded chooser. |
| P2 | Shared StudyDialog can close on internal empty space | Its click handler closes whenever `target === currentTarget`, including dialog padding, rather than checking whether the click was outside the dialog rectangle. Source-confirmed; add a browser reproduction before fixing. |

Two migration hazards also need explicit coverage: `Tasks.tsx` restores focus by querying literal `select[aria-label]` elements, and task/schedule forms clear errors and overlap approval through native bubbling `onChange`. Replacing native selects without updating these callers would introduce new bugs. They are integration requirements, not claims that these paths are broken today.

Existing separate prerequisite: online schedule extraction still needs the server `GEMINI_API_KEY` and real-provider validation, as recorded in the importer guide. Do not roll API setup, model accuracy, speech recognition, or weather work into this UI repair.

## Scope and constraints

- Keep the present Pomodoro art, distraction bin, folders, typography, layout, and light/dark palette.
- Repair the five techniques already visible. Do not add techniques, restore a larger tools gallery, or remove buttons to conceal failures.
- Pomodoro opens ready without asking for a goal. Task-based may use the existing task/description setup because its purpose requires a real task; no placeholder goal.
- Selecting a technique prepares it; **Start** remains explicit. Never silently replace an active/paused session or erase recorded focus time.
- Preserve existing saved sessions, tasks, folders, calendar entries, model identifiers, and asynchronous busy/error states. No storage migration.
- Dropdown scope means application single-choice option lists. Keep native file pickers, permission prompts, date/time pickers, and text/number fields; they are different controls.
- No multiselect, searchable command menu, option virtualization, new design system, broad dialog rewrite, or unrelated feature audit.
- Investigate suspected click obstruction or scrolling failures only if a targeted reproduction demonstrates them. The screenshot alone cannot prove these bugs.

## Proposed selector and visual behavior

Create `src/components/SelectField.tsx` for one controlled, select-only combobox with an option list. Keep its API to `value`, `options` (`value`, `label`, optional `disabled`), `onValueChange`, accessible label/id, disabled state, and the existing error/description association needed by callers. Support a forwarded trigger ref for focus restoration. Preserve placeholder options and empty values.

Use existing `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--hair`, and `--accent`. The trigger follows current field sizing and typography; the popup has a restrained border, a soft downward shadow, a selected check icon from the existing icon set, and distinct hover/focus/disabled states. No fixed white surface, decorative gradients, or new font.

- At least 44px option hit targets; labels wrap when necessary. Long folder, course and model names stay readable without horizontal overflow.
- One anchored popup on phone, tablet and desktop. Open above when space below is insufficient; clamp width/position and use a bounded scrollable list.
- Keep the popup inside the enclosing dialog's logical DOM so it is not made inert. Prefer a feature-detected native popover/top-layer presentation; provide one simple positioned fallback for supported WebViews without it. Do not rely on arbitrary large z-index values or portal options behind a modal.
- Follow the [WAI-ARIA select-only combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): accessible name/current value, expanded state, associated listbox, active option, arrows, Enter/Space, Escape, Home/End and character typeahead. Typeahead is keyboard navigation, not a new search interface.
- Highlighting an option does not run business callbacks. Commit on selection; Escape/outside dismissal preserves the original value. Escape closes the dropdown before closing its parent dialog.
- Trigger and option interactions must not submit an enclosing form. Close on selection, outside click, or dismissal; restore appropriate focus. Reposition or close safely on resize and enclosing-container scroll.
- Empty/removed option lists must not commit an invalid identifier. Busy/disabled controls cannot change values. Honour existing form error-clearing and overlap-reset logic explicitly.

See [MDN Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API) for the top-layer presentation mechanism. It handles presentation/dismissal; keyboard selection semantics remain the component's responsibility.

## File map

| File | Necessary change |
| --- | --- |
| `src/lib/session.ts` | Method-aware validation for count-up versus countdown methods; retain established accounting/phase behavior. |
| `src/components/Study.tsx` | Correct quick presets, meaningful Task-based setup, selected/disabled feedback, preservation of context. |
| `src/components/StudyTools.tsx` | Keep existing setup consistent with presets; migrate task chooser; narrow inside/backdrop click fix. |
| `src/App.tsx` | Guard invalid UI configuration before replacing session; show current toast/feedback. No App refactor. |
| `src/components/SelectField.tsx` | One reusable controlled selector and bounded popup. |
| `src/index.css` | Shared selector styles using current tokens and responsive limits. |
| Existing dropdown callers below | Replace only the field widget; preserve callbacks, options and state. |
| Existing checks and one selector interaction check | Verify changed behavior and update native-select-specific test operations. |

### Reachable dropdown migration inventory

- `Settings.tsx`: cloud model.
- `Overlays.tsx:LocalAiRow`: local Ollama model, reused by current Settings.
- `AndroidAiSettings.tsx`: phone model, shown when multiple models exist.
- `TaskEditor.tsx`: status, task kind, folder.
- `Tasks.tsx`: move task between zones; update focus restoration.
- `ScheduleEditor.tsx`: schedule category; preserve task-owned category restrictions and overlap reset.
- `AttachmentPlacement.tsx`: choose existing folder; preserve busy state and explicit destination choice.
- `Library.tsx`: move a chat attachment into a folder; preserve asynchronous errors and reset placeholder after a successful move.
- `TravelPlanner.tsx`: travel mode; retain estimate invalidation on changes.
- `StudyTools.tsx`: existing task selection for applicable setup.

The additional cloud selector in the old `Overlays.tsx:Onboarding` is not mounted by current App, which uses `Welcome`. Confirm reachability before migration. Do not revive or redesign unused onboarding solely to eliminate a source-code `<select>`.

## Implementation tasks

### 1. Repair technique selection and protect timer state

- [x] Add failing regressions for the exact quick-preset configurations, not only configurations built from `DEFAULT_CONFIG`.
- [x] Reproduce ready → Flowtime/Task-based fallback; verify both are genuinely count-up methods. Allow zero minutes only for count-up configurations, while retaining valid integer/range checks for countdowns and breaks/rounds.
- [x] Ensure a zero-minute representation never causes countdown completion, bad progress division, or immediate expiry in a count-up session. Test start, elapsed time, pause/resume, finish, and recovery using existing helpers.
- [x] Route Task-based without a real task/description into its existing setup; remove the invented `Focus goal`. Preserve an actual associated task when already available.
- [x] Retain applicable folder/task context when preparing another technique. Make the active technique label agree with the configured method, including an adjusted custom timer that is no longer exactly 90 minutes.
- [x] Validate UI drafts before replacing `sessionRef`/state. An invalid draft gives a useful message and leaves the current timer intact.
- [x] Keep running switches protected with nearby explanatory text; preserve the existing paused-session keep/finish decision. No automatic timer starts.
- [x] Correct the technique group's selected semantics and keyboard usability. Round numbers remain progress indicators, not new clickable controls.
- [x] Run helper and browser regressions, then verify save/reload and recorded focus totals.

### 2. Build and prove the shared dropdown

- [x] Write failing interaction checks for mouse/touch selection, keyboard navigation/commit/cancel, disabled options, long labels, and an option list inside a native modal.
- [x] Implement only the controlled single-select API described above. No dependency or general overlay manager.
- [x] Apply current light/dark tokens and viewport positioning. Test all popup corners, many options, and a short window.
- [x] Verify no unexpected form submission, no value commit on Escape, and no parent-modal dismissal when Escape is meant for the dropdown.
- [x] Verify focus return, screen-reader name/value/state, typeahead, and visible focus. Feature-detect the presentation mechanism and test its fallback.

### 3. Migrate callers completely without changing business behavior

- [x] Replace every reachable field in the inventory; retain each original value/identifier, placeholder, busy condition, option list, and callback.
- [x] Update task-zone focus restoration to the new trigger ref or semantic identifier; do not retain an obsolete `HTMLSelectElement` query.
- [x] Explicitly preserve task/schedule form error clearing and overlap-approval reset when a custom field changes. Do not assume a callback creates a native change event.
- [x] Preserve travel estimate invalidation, model-selection side effects, asynchronous attachment movement errors, and task-owned disabled category controls.
- [x] Test dynamic lists while open: deleted folders/tasks, model-list refresh and empty options. Close or refresh predictably without saving stale IDs.
- [x] Update `.selectOption()` regressions to exercise the custom control through its public semantics. Do not delete assertions or bypass the UI with state injection to make tests pass.
- [x] Search for remaining native selects and classify them as unreachable legacy code or a documented platform control; no reachable application option selector is missed.

### 4. Verify the related dialog fix and ship the bounded repair

- [x] First reproduce StudyDialog closing on a click inside its own padding. Narrow the handler to genuine outside-rectangle clicks, following the existing `Overlays.tsx:Sheet` approach.
- [x] Confirm an internal dropdown click keeps the parent dialog open. Escape/outside-click behavior remains intentional, and focus returns to the trigger after dismissal.
- [x] Test 320×568, 390×844, 768×1024, 1440×900, and 1280×500; include live resize, dark mode, reduced motion, long labels and browser zoom. No clipped menus/actions or horizontal overflow.
- [x] Run `check-study-tools.mjs`, `check-study-ui.mjs`, `check-task-ui.mjs`, `check-revised-ui.mjs`, `check-settings.mjs`, `check-adaptive-ui.mjs`, and new focused dropdown/timer regressions as applicable. Keep screenshot output in `/tmp` when not intentionally changing goldens.
- [x] Run TypeScript, production build, and whitespace checks. Validate Android phone-model interaction on a device when available; web tests alone must not be reported as native-device verification.
- [x] Review the final diff for scope, retained data/behavior, and accessibility. Record evidence and any remaining environment limits before declaring the repair finished.

## Definition of done

Every visible technique either prepares the correct timer or clearly explains a protected/invalid state; no silent fallback and no placeholder task. All reachable application option dropdowns use the same themed selector and work by touch, mouse and keyboard, including within dialogs. Existing save, validation, model, folder, travel and task behaviors survive migration. Relevant tests pass and the responsive popup is inspected. No unrelated redesign or feature addition.

## Audit limits

This is a targeted timer/dropdown/dialog audit, not a claim that every feature in the project has been tested. No confirmed obstruction was found for the working ready-state buttons. Full-screen browser notices and the Grammarly overlay visible in the screenshot are outside application ownership; only investigate them if the same click failure reproduces without extensions. Real service credentials and native-device availability remain separate prerequisites.


## Execution record — October 14, 2026

- Implemented inline with the executing-plans and test-first workflow. No new dependency, storage schema, larger tools gallery or unrelated UI redesign. The existing checkout was kept for the running preview.
- Watched failing regressions for zero-duration Flowtime/Task-based configurations and the missing custom selector, then observed their passing results. Browser checks exercise exact presets, real task selection, preserved associations, explicit Start, count-up, pause/switch, custom selected state, invalid duration and reload.
- Replaced every reachable option selector in the migration inventory. The only remaining native select is in the unused old Onboarding component; current App mounts Welcome. Native date/time/file inputs remain platform controls as scoped.
- Task/schedule selection callbacks explicitly reset validation and overlap approval. Task-zone focus restoration now targets the combobox trigger. Existing model, folder, travel, busy/error and persistence callbacks are preserved.
- Reproduced StudyDialog closing on internal padding, then fixed only outside-rectangle dismissal. Shared dialog titles now use unique IDs. Setup's Back label matches the existing return behavior; the paused-switch button says Keep current session, matching its non-resuming action.
- A fresh-context reviewer found closed Home navigation retained the previous option. The failing browser assertion was observed, repaired, and independently verified in both native-popover and fallback modes. No other concrete findings remained in that review.
- Ruling: “Pomodoro goal-free” means no required goal setup/prompt. An already selected real task title/ID remains associated when switching techniques, as required by the context-preservation requirement. No placeholder goal is created.
- Verification passed: timer-preset helper, selector semantics, timer-controls browser flow, dropdown keyboard/Home/End/typeahead/cancel/form safety/disabled state/dynamic removal, touch and dark mode, five popup viewport sizes, zoomed mobile visual viewport, modal-safe fallback; existing study-tools/study-UI, attachment placement, revised attachment/folder/travel/calendar/chat flow, task editing/moving/focus/drag/reload, settings and nine-size adaptive checks. TypeScript, production build and whitespace checks passed. Build retains the pre-existing large-bundle/ONNX runtime warnings.
- Test captures are in /tmp; the known generated task screenshot was restored to its original Git blob, and its script now accepts an output-path override. No intentional golden-image update.
- Tooling recovery: pnpm initially attempted a dependency restore during a check, which sandbox networking blocked. Restored the existing dependency set using the frozen lockfile; package.json and the lockfile were not changed for this task.
- Native Android hardware/model-selection interaction was not tested: adb was unavailable on PATH. Chromium touch/viewport and popover-fallback checks are browser evidence, not a claim of Android-device verification. This conditional hardware check remains external validation.
- Concurrent edits appeared in conversation.ts, groq.ts, schedule-answers.ts and travel.ts during this work. They were preserved; they are outside the timer/dropdown change.
