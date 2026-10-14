# Folders, Pomodoro, and Pal Context Implementation Plan

> **For agentic workers:** Use `executing-plans` for inline implementation when authorized. Execute task-by-task and keep an evidence ledger. Pending checkboxes mean planned work, not completed work.

**Goal:** Apply the user's corrections to attachment filing, flashcards, Pomodoro, dragging, Pal knowledge, time pronunciation, and local weather.

**Architecture:** Keep the existing React app and saved view keys. Extract attachment placement and contextual knowledge into focused components/helpers; add only compatible storage changes. Keep calendar/task helpers authoritative and the existing timer state machine intact.

**Tech Stack:** React 19, TypeScript 5.7, Vite 8, Tailwind CSS 4, IndexedDB/localStorage, Pointer Events, current SVG assets, existing speech and weather services. No new dependency is presently required.

**Spec:** [Revised design](../specs/2026-10-14-folders-pomodoro-and-pal-context-design.md).

**Status:** Implemented in the local feature checkout; automated verification and independent review fixes are complete. See [the execution ledger](2026-10-14-folders-pomodoro-progress.md) for evidence and external testing limits. This plan supersedes conflicting choices in the completed Block Yard/Study plan.

## Global constraints

- Labels: **Folders** and **Pomodoro**. Preserve folder artwork and timer illustration.
- No automatic folder creation or automatic attachment placement.
- Restore tap-to-flip flashcards; revealed card swipes right = known, left = not yet.
- No Pomodoro goal questionnaire or primary tool gallery. Keep functional timer controls.
- Discarded distraction text does not enter task, chat, or AI records.
- Preserve all existing tasks, files, decks, progress, calendars, and active sessions.
- Current task/calendar synchronization and three-task Workbench limit remain authoritative.
- No deployment, data reset, or unrelated checkout cleanup. Do not stage unrelated existing changes.
- Use failing regression → minimal change → passing regression for each behavioral change. Record actual commands/results, including limits of emulated device checks.

## Review focus

1. Cancelled/failed/batched imports must not silently file documents or create duplicate records (Task 1).
2. Vertical scrolling, pointer cancellation, and rapid repeated answers must not advance flashcards twice (Task 2).
3. Portal drag offsets must remain correct inside glass/transformed containers and while scrolling; a fourth Workbench task must remain rejected (Task 4).
4. Async folder retrieval, deleted files, and concurrent task edits must not produce stale model facts or let document text become instructions (Task 5).
5. Location denial/change and separated rainy hours must not produce misleading weather advice or reuse another place's forecast (Task 7).

## Task 1 — Folders and explicit attachment placement

**Files:** Modify `src/components/Study.tsx`, `Library.tsx`, `Today.tsx`, `src/App.tsx`, `src/lib/library.ts`, `src/lib/study-files.ts`; create `src/components/AttachmentPlacement.tsx` and `scripts/check-attachment-placement.mjs`.

**Interfaces:** `AttachmentPlacement({files: File[], folders: Folder[], onChoose: (destination: {kind:'folder';folderId:string}|{kind:'new-folder';name:string}|{kind:'chat'}) => Promise<void>, onCancel: () => void})`. Library files use `folderId: string | null` for explicit unfiled storage; existing string values remain valid. `moveFileToFolder(fileId: string, folderId: string): Promise<void>` validates both records before updating the link. Chat attachment cards retain the saved file ID for reload/retrieval.

- [x] Add browser regressions: zero folders shows Create folder/Keep in chat/Cancel; existing folders show an unselected picker; dismiss creates no folder/file; chosen folder receives exactly one file; new folder is created only after explicit selection; unfiled attachment survives reload; moving it retains file ID and deck history; batch failures are per-file.
- [x] Run the new browser test and observe the automatic-filing behavior fail these expectations.
- [x] Rename visible headings/tabs/shortcuts to Folders/Pomodoro while preserving `library`/`focus` saved keys. Replace `attachFile`'s current `suggestFolder`/`newFolder` auto-flow with the placement sheet. Create/import only after explicit choice; disable repeated submission; report import errors and allow retry/cancel.
- [x] Audit all `folderId` consumers for unfiled records: folder counts exclude them, contextual chat retrieval includes them, deleting a folder deletes only its linked files. Importing directly inside an open folder may retain that explicit destination.
- [x] Run the new browser suite, existing study/library regressions, TypeScript, and offline/reload checks. Verify sheet bounds and final action accessibility at 320/390/768/1024/1440 px and 320×340.

## Task 2 — Restore the familiar flip-and-swipe flashcards

**Files:** Modify `src/components/CardPractice.tsx`, `Library.tsx`, `src/lib/card-practice.ts`, `src/index.css`, `scripts/check-card-ui.mjs`, `scripts/check-cards.mjs`.

**Interfaces:** A dedicated flashcard view uses the existing `Deck`, `CardProgress`, `cardProgressKey`, `answerQueue`, and `recordCardResult(key,'swipe',correct)`. Separate Quiz remains a file action and records its own mode history; hidden Recall records are retained.

- [x] Change browser expectations: no three-mode toolbar on Flashcards; card click toggles question/answer; pre-reveal swipe records nothing; revealed horizontal right/left records known/not-yet exactly once; vertical/short/cancelled gestures do nothing; offline reload retains progress and unchanged-content identity.
- [x] Observe the current reveal-button UI fail the restored card-click expectation.
- [x] Restore the prior paper/flip markup and perspective; front and back have readable long-text handling and only the active face exposed to accessibility. Use pointer capture for horizontal gestures without disabling vertical scrolling. Animate the card leaving in the swipe direction, then reset the next card; reduced motion advances immediately.
- [x] Add equivalent Know/Not yet buttons and keyboard handling when the card is focused: Space/Enter flips; Right/Left marks only after reveal, except when typing in an input. Block duplicate answers and answers during deck generation.
- [x] Keep Quiz and Read separate from Flashcards; preserve old saved quizzes and deck generation. Test fewer than two distinct answers with a useful fallback; retain bounded missed-card repetition and final score.
- [x] Run helper/browser card suites plus study library regressions. Inspect light/dark and long cards on phone/tablet/desktop.

## Task 3 — Pomodoro directly, with a distraction bin

**Files:** Modify `src/components/Study.tsx`, `StudyTools.tsx`, `Today.tsx`, `src/index.css`; create `src/components/DistractionBin.tsx`; modify `scripts/check-study-ui.mjs` and add browser coverage in `scripts/check-task-ui.mjs`.

**Interfaces:** `DistractionBin` owns a localStorage draft under `paldo.pomodoro-distraction`; it has no task or AI callback. Existing session callbacks remain unchanged.

- [x] Add failing tests: selecting Pomodoro opens the ready timer without gallery/setup; Start remains explicit; distraction entry changes no session/task; Throw away erases the draft; unfinished draft survives reload; blank draft cannot be thrown away; discarded text is absent from saved chat/task/context.
- [x] Open new idle sessions directly as ready Pomodoro and update copy/navigation. Retain running/paused/away legacy-method sessions with compatibility controls until the user finishes them; never replace an active session silently.
- [x] Add the paper field and trash affordance: desktop alongside timer where space permits, tablet/phone below. Use existing SVG icon vocabulary; brief throw-away feedback with reduced-motion equivalent; textarea remains keyboard-visible and scrollable. Make storage failure visible while keeping the field usable.
- [x] Run study UI/session tests and browser ready/running/paused/break/away reload tests. Verify writing and discarding do not affect elapsed time or alarms.

## Task 4 — Make the whole task follow the pointer

**Files:** Modify `src/components/Tasks.tsx`, `src/index.css`, `scripts/check-task-ui.mjs`.

**Interfaces:** `DragPreview({task: Task, folder?: Folder, clientX:number, clientY:number, grabX:number, grabY:number, width:number})` renders via `createPortal(..., document.body)`. Existing `onMove` and `transitionTask` continue to determine allowed status changes.

- [x] Add a failing geometry regression: preview top-left equals pointer minus initial grab offset within 2 px, including a transformed ancestor and scrolled board. Test touch cancel, valid drop, rejected fourth slot, destination highlight, and keyboard focus restoration.
- [x] Replace the text-only in-container preview with a reusable actual paper-card render in the body portal. Use fixed viewport coordinates, pointer-events none, and the measured original width; avoid copying interactive IDs/controls into the preview.
- [x] Keep a placeholder, track/drop against current destination rectangles, and clean up capture/listeners/preview on release, cancellation, lost capture, unmount, or resize. Preserve vertical scrolling outside the drag handle and provide edge scrolling when dragging near the board bounds.
- [x] Run task UI and helper suites, synthesized mouse/touch drag, short-window and reduced-motion checks. Mark physical touch testing separately.

## Task 5 — Give every Pal the current tasks and folders

**Files:** Create `src/lib/pal-knowledge.ts`, `scripts/check-pal-knowledge.mjs`; modify `src/App.tsx`, `src/lib/context.ts`, `conversation.ts`, and `schedule-answers.ts` as needed.

**Interfaces:** `buildPalKnowledge(input: {query:string;tasks:Task[];folders:Folder[];files:LibraryFile[];now:number}, budget:number): {text:string;taskIds:string[];folderIds:string[];fileIds:string[]}`; `answerKnowledgeQuestion(query:string,input:...): string | null` for deterministic inventory answers. Passage retrieval reuses existing `search` from `study-material.ts`.

- [x] Add failing fixtures for undated Pile tasks, doing/done tasks, notes matching a query, renamed/deleted folders, unfiled chat files, empty inventory, exact task/folder titles, and a stale async read after a newer request. Test deterministic output length and existing full-calendar prompt budget.
- [x] Read the latest task/event refs and folder/file inventory for each turn; refresh on `LIBRARY_EVENT`; guard async results by turn identity. Select relevant notes/file passages within the final context budget rather than adding the entire collection.
- [x] Supply the same authoritative snapshot to cloud/local/phone-model paths and deterministic offline inventory answers. Do not claim content knowledge for unread/scanned files. Treat retrieved file text as untrusted reference material and preserve current confirmation rules for mutations.
- [x] Run the new suite, `pnpm eval:chat`, existing plan-title/event-choice regressions, and offline browser questions about real task/folder records.

## Task 6 — Rei says A M and P M correctly

**Files:** Modify `src/lib/speech-profile.ts`, `native-tts.ts`, `scripts/speech.mjs` if the server applies its own normalization; extend `scripts/check-schedule-speech.mjs` and voice fixtures.

**Interfaces:** `cleanSpeech(raw:string,pal?:PalId,englishRequested?:boolean):string` stays stable; its clock-suffix output becomes language/voice-aware. Avoid normalizing an already normalized speech string twice.

- [x] Add failing assertions: Rei's `7 AM` uses an English-letter representation rather than `ey em`; `4 PM`, `9:30 PM`, ranges, dotted suffixes, noon/midnight, and untouched visible text. Retain Jhyvie's separate pronunciation fixtures and all four distinct voices.
- [x] Trace the complete speech pipeline before changing it. Use `A. M.` / `P. M.` as the first English-voice candidate; validate the selected Rei voice actually says the English letter names. If it does not, choose a verified provider-supported pronunciation representation without changing displayed text. Do not impose one phonetic spelling on every voice.
- [ ] Audible preference/device follow-up: real playable Rei/Jhyvie samples were generated and server/profile checks passed; user listening and physical-device fallback remain to be verified. test the server path and available browser/native fallbacks. Record unavailable physical-device voice checks rather than claiming string tests prove audio correctness.
- [x] Run schedule speech, wake/transcript, voice/session, and full chat regressions.

- [x] User-added: verify Rei saying “Hi, Pol” and longer English samples; speech-only pronunciation may use “Paul” for the user name if the selected voice misreads Pol. If still unnatural, switch Rei to a distinct English male voice and preserve the other three profiles. Validate samples before reporting it fixed.

## Task 7 — Reliable location-aware weather and suggested times

**Files:** Modify `src/lib/weather.ts`, `src/components/Settings.tsx`, `src/App.tsx`, `src/lib/context.ts`, `next-step.ts`; create `scripts/check-weather.mjs` and browser location fixtures.

**Interfaces:** `WeatherLocation = {id:string;label:string;lat:number;lon:number;timezone:string;source:'device'|'manual'}`; Weather includes `locationId`, area/source/timezone, fetched time, forecast validity bounds and `hours: {at:number;rainProbability:number|null}[]`. `weatherForInterval(weather:Weather,start:number,end:number,now:number): {available:boolean;rainProbability?:number;reason?:string}` evaluates the whole requested interval. Retain migration or invalidation for the old weather cache.

- [x] Verify current official weather-provider request/timezone/geocoding documentation during implementation before selecting new request fields; preserve the existing provider unless a concrete limitation requires a change.
- [x] Add failing tests for permission denied/no geolocation, manual city, location change within 30 minutes, stale/offline cache, timezone differences, disjoint rainy hours, partially covered intervals, tomorrow's suggestions, malformed response, and weather/calendar conflict.
- [x] Add Use my location and manual city controls with explicit source/area/update time. Request permission from this control; reuse existing granted access. Remove silent Manila-as-user fallback. When no location is configured, ask for an area or explain weather is unavailable.
- [x] Fetch/cache a 48-hour hourly horizon by location/timezone with 30-minute freshness; validate response fields and preserve unknown probabilities. Superseded requests cannot overwrite a newly selected location's cache. Old offline forecasts show their age and cannot be framed as current.
- [x] Format rainy periods as separate intervals. Feed Pal area-level facts and interval-specific weather; prefer dry calendar-free times only for explicitly outdoor plans, explain the forecast reason, and retain user confirmation. Never silently move a booked event or describe uncertain forecasts as certain.
- [x] Run helper/browser weather suites with mocked coordinates/provider responses; verify stale/denied/offline copy, schedule regressions, and timezone boundaries. Record physical-device permission testing separately.

## Task 8 — Tagalog travel understanding and grounded route estimates

**Files:** Create `src/lib/travel.ts`, `src/lib/routes.ts`, `scripts/check-travel.mjs`, and a routing proxy endpoint following the repository's existing server pattern; modify `src/lib/parse.ts`, `agent.ts`, `conversation.ts`, `context.ts`, `core.ts`, `src/App.tsx`, and transportation card/details rendering.

**Interfaces:** `TravelDraft = {id:string;rawText:string;date?:number;departure?:number;origin?:ResolvedPlace;destination?:ResolvedPlace;mode?:'driving'|'walking'|'cycling'|'transit';estimate?:RouteEstimate}`. `ResolvedPlace = {id:string;label:string;lat:number;lon:number}`; `RouteEstimate = {provider:string;fetchedAt:number;durationSeconds:number;distanceMeters:number;departureAt?:number;trafficBasis:'future'|'current'|'baseline';mode:string}`. `parseTravelIntent(text:string,now:number): TravelDraft | null`; `findPlaceCandidates(query:string): Promise<ResolvedPlace[]>`; `estimateRoute(draft:TravelDraft,signal:AbortSignal): Promise<RouteEstimate | null>`. Store optional `travel` metadata on the existing CalEvent, with confirmed endpoints/mode and estimate provenance.

- [x] Add failing tests for the exact “Aalis kami papuntang Quezon sa October 16” report: travel intent, October 16 preserved, missing departure asks “Anong oras kayo aalis?”, no generic event title and no duration invented. Add Quezon ambiguity, suspected Kessons transcription, Taglish phrasing, departure replies, confirmed-origin requirements, unrelated similar-sounding words, changed route inputs, and an unsupported transit route.
- [x] Add Philippine place candidates/aliases and a travel-specific conversation state. Keep raw speech and an explicit resolved-place correction step; consult provider-supported language/location hints without claiming they fix all recognition. Clarify ambiguous province/city/town/address and mode before estimating. A valid destination reply must continue the travel draft rather than create a new event.
- [x] During implementation, verify official routing/geocoding documentation, Philippine coverage, allowed modes, traffic/departure support, attribution, request limits and cost. Select a concrete provider based on those constraints; document the selection before integration. If it needs account credentials unavailable in this workspace, implement a configured adapter and honest unavailable/manual fallback; do not claim live routing was verified.
- [x] Fetch and validate real route data outside the model; keep credentials server-side. Present duration/distance/source/fetched time and the actual traffic basis. Abort/ignore superseded requests; invalidate estimates whenever route endpoints, travel mode or departure change. Current-traffic results must not be described as future traffic predictions.
- [x] Render a Transportation confirmation card with origin, destination, departure, duration and estimated arrival only when duration is sourced or manually supplied. For unknown duration retain a pending draft and ask for an estimate rather than reserving a fabricated time. Manual duration is explicitly labeled Your estimate.
- [x] Save a single explicit transportation calendar block with stable ID and provenance. Add a distinction such as `transportSource:'user-trip'|'routine'` so existing routine-commute regeneration/deletion leaves explicit trips alone; audit all commute filters in scheduling, Calendar, Today and context. No duplicate task or automatic reschedule.
- [x] Run travel/parser/conversation tests and browser mocked map flows: ambiguity, delayed replies, no key, offline, timeout, future/baseline estimate copy, manual fallback, midnight arrival, accept/edit/reload. Verify a real provider response separately if configured; mocked estimates do not establish live accuracy.

## Task 9 — Add/edit schedules manually, with notes

**Files:** Create `src/components/ScheduleEditor.tsx`, `src/lib/schedule-edit.ts`, `scripts/check-schedule-editor.mjs`; modify `src/components/Calendar.tsx`, `Today.tsx`, `Overlays.tsx`, `src/App.tsx`, `src/index.css` and task/calendar helpers where needed.

**Interfaces:** `ScheduleDraft = {title:string;kind:Kind;start:number;end:number;note:string;travel?:CalEvent['travel']}`. `validateScheduleDraft(draft:ScheduleDraft):string[]`; `applyScheduleEdit(before:CalEvent|null,draft:ScheduleDraft,latest:CalEvent[],allowOverlap:boolean): {events:CalEvent[];event:CalEvent}` preserves an edited ID and checks stale originals. Task-owned events require a coordinated task/event transaction through existing task helpers.

- [x] Add failing browser assertions: visible Add schedule in Week and Today; create offline with no AI; title/date/start/end/category and multiline notes; save/reload/edit retain one ID; Cancel/discard save nothing; invalid/overnight ranges, overlap warning and deliberate override; AI edit during an open editor is not overwritten.
- [x] Add responsive ScheduleEditor with desktop detail panel/mobile full-screen form, accessible labels, Save/Cancel, scrollable body and fixed actions. Add Edit schedule to existing event details, display notes, and retain manual Transportation as an available category. Do not force the user through chat or Block Yard to edit calendar entries.
- [x] Save one event over current snapshots; preserve recurrence/reminder metadata and unrelated events. Task-owned edits update their owning task schedule/due/notes through the appropriate existing link, and do not duplicate deadline or study blocks. Ordinary manual schedules do not create tasks automatically.
- [x] Permit explicit end date for overnight schedules; validate finite times and end after start. Reuse conflict display/confirmation patterns; route estimates are optional and cannot block offline user-entered times. Notes remain multiline plain text with a 20,000-character limit and safe rendering.
- [x] Run schedule editor/browser and task synchronization regressions, reminder tests, full chat suite, offline/reload, keyboard focus and viewport checks including 320×340 and long notes. Confirm routine commute maintenance preserves a manually entered trip.

## Task 10 — Preserve conversational titles and confirm uncertain names

User-added regression: “I have a meeting later” → “it will start at 3pm” → “it will end at 4pm” must retain Meeting, never Will. A new intent must replace an unrelated stale draft. Follow-up time/date replies fill their awaiting slots instead of re-running generic title extraction.

- [x] Add failing parser/conversation and browser fixtures for that exact sequence, Tagalog equivalents, interrupted drafts, explicit title corrections, and ambiguous transcriptions.
- [x] Validate proposed titles against the user's substantive activity words and current draft. Reject filler/pronoun/auxiliary titles such as Will or It; preserve a grounded earlier title. When still uncertain, offer a concise candidate and ask whether the title is correct before asking further scheduling details or offering a save card.
- [x] Confirm explicit corrections update the same draft, and saved confirmation cards show the grounded title and full range. Run plan-title/event-choice/full chat regressions.

## Task 11 — Final consistency and delivery

- [x] Verify all requested concerns map to completed phases: labels/filing, flashcards, Pomodoro/bin, drag, AI knowledge, pronunciation, location/weather, Tagalog destinations/maps-based trips, and manual schedule creation/editing/notes.
- [x] Run `pnpm eval:chat`, task/card/study/attachment/knowledge/weather/speech/travel/schedule-editor suites, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check`.
- [x] Update intentional UI assertions; run adaptive browser checks at 320/390/768/1024/1440/1920 px and short landscape. Inspect light/dark, long notes/files/cards, keyboard focus, reduced motion, offline/reload and all modals.
- [x] Review the actual diff and run one independent final review when the execution workflow allows it. Fix material findings and retest their affected flows. Update this plan's checkboxes and evidence ledger only from observed results.
- [x] Deliver the local preview changes with a concise report of implemented behavior, test results, audio validation, and remaining physical-device checks. No merge/push/deployment without separate authorization.

## Added review focus for travel and manual schedules

- Quezon Province versus Quezon City and a noisy “Kessons” transcript must trigger place confirmation, not a silent destination guess (Task 8).
- A current driving estimate cannot be relabeled as future public-transport travel time; unsupported data must produce an honest fallback (Task 8).
- Explicit Transportation trips must survive routine commute cleanup, and manual notes must not sever task-owned calendar links or overwrite concurrent edits (Tasks 8–9).

## Proposed execution order and assumptions

Implement Tasks 1–4 first so the visible flows match the user's request, then Pal context, pronunciation, weather, travel routing, and manual schedule editing. Each phase must remain independently usable. Recommended approach: inline execution in the existing feature checkout with a final review; preserve unrelated changes.

The implementation and automated checks are complete in the existing preview. Audible preference and physical-device behavior remain explicitly recorded follow-up checks. Defaults requiring no blocking clarification for this draft: durable unfiled attachments, local unfinished distraction drafts with no discarded history, existing distinct voices, and weather treated as an advisory signal. The user may revise those defaults before implementation.

## User-added — Onboarding Pal composition

- [x] Enlarge and center the four-Pal group with the introductory content; preserve their original SVG/pixel art, aspect ratios and crisp rendering.
- [x] Place shadows beneath each Pal's feet with consistent perspective, size and opacity; eliminate the detached shadows shown in the screenshot.
- [x] Use bounded responsive sizes and group spacing at desktop/tablet/phone and short landscape. No clipped characters, horizontal overflow or inaccessible Get started action.
- [x] Add geometry/overflow checks to the adaptive onboarding suite and inspect screenshots at 390/768/1440 px plus short windows.
