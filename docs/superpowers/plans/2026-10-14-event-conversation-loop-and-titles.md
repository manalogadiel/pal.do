# Event Conversation Loop and Titles Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement this plan task by task. Check each step only after its regression passes. This document authorizes planning only; implementation requires the user's next instruction.

**Goal:** Preserve a user's event details across chat/voice replies, ask only for missing information, and produce faithful activity titles such as “Morning walk.”

**Architecture:** Keep the existing `ConversationFocus` as the authoritative event draft. Merge user-supplied fields into that draft, derive the next question from its missing fields, and build the existing confirmation card from the complete draft. The model may help interpret a new activity, but cannot erase supplied fields, replace a corrected title, or decide which known detail to ask again.

**Tech stack:** Existing React, TypeScript, Vite, parsing helpers, calendar confirmation cards, and current speech pipeline. No dependencies or model changes.

**Spec:** The user's October 14 screenshot and follow-up in this chat: start/end questions alternate despite answers; supplied titles are overridden; “I like to have a morning walk” should yield “Morning walk.” The behavior below is the complete scoped specification.

## Verified causes

Read-only investigation reproduced these transitions with the current production helpers:

1. An event draft receives `tomorrow 5 PM–6 PM`: tomorrow, start, and end are stored.
2. The reply `coffee date` produces a named event but drops the stored day, start, and end. In `updateConversationFocus`, the newly recognized activity kind goes through a branch that creates an empty draft when the old title was missing.
3. `6:00 p.m.` now becomes a new start on today, because the earlier facts are gone. The formatter recognizes the dotted PM spelling correctly; this is a draft/state bug, not a speech pronunciation bug.
4. `extractTitle('I like to have a morning walk', '')` returns `Like have walk`. Global filler removal strips `morning`, while the request wrapper is only partly removed.

Additional code risks that must be covered during implementation:

- The complete-draft preview in `App.tsx` is gated on a time-bearing last message or previous `awaitingEnd`. A final title-only reply can fail to open confirmation even when the time range is known.
- Cloud wording bypasses some deterministic missing-field questions. The model action branch can replace the conversation with an incomplete event and ask for a field the user already supplied.
- Title confirmation and event details are handled in different branches; rejecting a proposed title can clear unrelated draft facts.

The screenshot's earlier user message is not available, so these are verified reproductions and identified code paths, not a claim that every unseen turn was reconstructed.

## Scope and rules

- Apply the shared fix to all four Pals, typed chat and voice transcripts, and offline/cloud/local/native AI modes.
- Preserve existing calendar storage, persistence, event types, overlap handling, confirmation controls, and reminders.
- Keep the current draft shape. Derive the next field from known values; do not introduce another conversation framework or parallel draft store.
- A title answer or rename updates the title only. Recognizing an event kind does not start a new draft.
- A start answer updates start; an end answer updates end; a day correction updates the date while retaining supplied clock times.
- Clear a draft only for cancellation, an explicit new event request, or successful completion through the existing confirmation flow.
- Do not save automatically. A complete draft opens the existing preview and still needs explicit confirmation.
- Do not invent missing dates, durations, AM/PM, subjects, or event names. Retain existing supported date defaults where already established; show those defaults in the preview.
- No unrelated UI redesign, importer changes, voice changes, routing changes, dependency additions, or model upgrades.

## Expected behavior

| User input / condition | Required result |
| --- | --- |
| `tomorrow 5 PM–6 PM`, then `coffee date` | Preview **Coffee date**, tomorrow, 5 PM–6 PM. No second start/end question. |
| `Coffee date tomorrow`, then `5 PM`, then `6:00 p.m.` | Ask start once, end once, then show confirmation. |
| A known end is supplied before the start: `ends at 6 PM` | Keep that end and ask for the start. Answering start must not discard end. |
| `I like to have a morning walk` | Proposed title **Morning walk**, retaining “morning” as part of the activity. |
| `I'd like to have a morning walk tomorrow at 7 AM` | Title **Morning walk**; tomorrow and 7 AM are scheduling facts. Ask only for the end. |
| `The title is Morning Walk with Mama` | Keep the supplied title's words and casing. |
| `No, call it Coffee with Ana` | Replace only the title, keep day/start/end, update the preview. |
| `No, that title is wrong` | Ask for the replacement title and retain the time range. |
| End equals or precedes start without a supported explicit next-day date | Explain the conflicting times and ask for the end correction; keep start. Do not alternate questions or silently change AM/PM. |
| Repeated `6 PM` after a completed draft | Preserve the draft/preview; do not start collecting the same fields again. |
| `Add another event` or cancellation | Follow the existing explicit new-request/cancel behavior. |

An ambiguous activity gets one focused clarification. A clear request does not need an extra title-confirmation question; the final event preview remains editable and explicitly confirmed.

## Files and responsibilities

- `src/lib/conversation.ts`: merge event fields, preserve draft facts, derive the next required field, validate start/end answers.
- `src/lib/parse.ts`: remove request wrappers without deleting meaningful title words; preserve explicit titles and existing time parsing.
- `src/lib/title-confidence.ts`: flag truly incomplete/unclear titles rather than accepting leftover request fragments.
- `src/App.tsx`: use the authoritative draft for questions, title correction, model action reconciliation, and confirmation.
- `src/lib/groq.ts`: only if necessary, align the existing focus description/action validation with the authoritative draft; prompt-only changes are insufficient.
- `src/lib/agent.ts`: reuse existing Pal-specific questions; add wording only if an actual missing-field/invalid-range message is absent.
- `src/lib/chat.reliability.ts` and `scripts/check-title-confidence.mjs`: permanent parser/state/title regressions.
- Create `scripts/check-event-draft-ui.mjs`: exercise actual app turns and preview state through existing browser-test patterns. Mock external recognizer/model responses only, not the production reducer or confirmation logic.

## Review focus

1. Time-first, title-last replies must preserve date and both times.
2. A model response that omits known facts must not reset the draft or display a contradictory next question.
3. Explicit start/end corrections must change only the requested field, including dotted AM/PM voice transcripts.
4. Title cleanup must retain activity modifiers, people, course codes, places, and explicitly supplied names.
5. Rapid voice turns, reloads, and repeated confirmations must not resurrect an old question or save twice.

## Task 1: Preserve event facts and derive the next field

**Files:** `src/lib/conversation.ts`, `src/lib/chat.reliability.ts`.

**Interfaces:** Preserve `updateConversationFocus(previous, userText, now)` and `eventFromFocus(focus)`. Add a small exported `nextEventField(focus: ConversationFocus): 'title' | 'start' | 'end' | 'confirm' | null` in `conversation.ts`. Return `null` outside event collection; incomplete/invalid end belongs to `end`, not `start`.

- [ ] Write regressions for the two Coffee date sequences above, asserting exact tomorrow timestamps, title, and the next field after each reply.
- [ ] Add end-first, title rename, day correction, start correction with a still-valid known end, repeated time replies, and explicit new-request/cancellation cases.
- [ ] Run `node scripts/eval-chat.mjs` and observe the new cases fail for the identified state loss.
- [ ] Merge fields into the active event unless the user explicitly starts another event. Preserve known range while filling or replacing its title/kind. Keep `awaitingEnd` consistent with the resulting fields for existing callers and saved sessions.
- [ ] Target single time replies using explicit start/end wording first, otherwise the next required field. A plain reply to an end question must not become a new start.
- [ ] Reject contradictory explicit end times without erasing start or silently shifting their AM/PM. Keep existing supported overnight behavior only when the user actually supplies the next-day information.
- [ ] Rerun the regressions. Every valid sequence must reach `confirm` without alternating back to an already known field.

## Task 2: Extract faithful activity titles

**Files:** `src/lib/parse.ts`, `src/lib/title-confidence.ts`, `src/lib/chat.reliability.ts`, `scripts/check-title-confidence.mjs`.

**Interfaces:** Preserve `extractTitle(text, fallback)`, `suppliedEventTitle(text)`, and `titleNeedsConfirmation(raw, title)`.

- [ ] Write failing title regressions for `I like to have a morning walk` → `Morning walk`, `I'd like to have an evening run` → `Evening run`, and `Can you schedule a coffee date tomorrow 5 PM–6 PM?` → `Coffee date`.
- [ ] Protect explicit names: `Morning Walk with Mama`, `May review`, `Wednesday Club`, `CS101 lab`, and the existing birthday/person-name cases. Scheduling words inside an explicit title must remain title words.
- [ ] Include Taglish request wrappers such as `Gusto ko mag morning walk bukas` and title-only replies such as `coffee date`. Keep an explicit supplied title exact; use existing sentence capitalization for inferred titles.
- [ ] Run `node scripts/check-title-confidence.mjs` and `node scripts/eval-chat.mjs`; confirm the added failures.
- [ ] Strip recognized request phrases at the beginning of an inferred title as phrases, not scattered meaningful words. Remove only actual scheduling clauses when deriving an activity title; do not globally delete activity modifiers such as morning/evening.
- [ ] Preserve current exact-title handling. Incomplete leftovers such as `Like to have` must prompt for the activity rather than becoming a card title. Avoid a synonym catalog, general NLP engine, or speculative correction of names.
- [ ] Rerun all title/state cases, including existing travel, study, and event-title regressions affected by the shared parser.

## Task 3: Make the app's draft control collection and confirmation

**Files:** `src/App.tsx`, optionally the existing wording/validation paths in `src/lib/groq.ts` and `src/lib/agent.ts`; new `scripts/check-event-draft-ui.mjs`.

**Interfaces:** Consume `nextEventField`, `updateConversationFocus`, and `eventFromFocus`; reuse `saveConversation`, `previewEvent`, and existing card-confirmation actions.

- [ ] Write browser regressions for screenshot-style typed turns and voice transcripts. Inspect the real preview's title/date/start/end and the persisted draft after each turn.
- [ ] Feed contradictory/incomplete external model responses: ask start when start is known, omit end after the user supplied it, or replace a corrected title with the old name. Expected result: the app retains user facts and follows the correct missing-field/preview path.
- [ ] Run the new browser test and observe the failures before changing app orchestration.
- [ ] For event field collection, choose the next question from the draft in every provider mode. Use existing Pal-specific wording. Do not stream a model-generated missing-field question that contradicts the selected field.
- [ ] When the last missing value is a title, immediately create the same complete event preview used after a final time answer; remove the time-only gate for this completion path.
- [ ] A model proposal must preserve known user title/date/start/end. It may fill genuinely missing grounded information through existing validation, but cannot replace supplied values unless the latest user turn explicitly corrects them.
- [ ] Title rejection/renaming must keep unrelated event facts. Maintain existing distinction between declining a suggested title and cancelling the whole event.
- [ ] Supersede the earlier preview when a title/time changes; keep one current confirmation target. A repeated reply or confirmation must not produce duplicate saves.
- [ ] Rerun across all four Pal IDs and provider branches using controlled external responses; retain normal chat/question, overlap, new-event, and cancellation behavior.

## Task 4: Finish regression verification

- [ ] Check that reloading during an incomplete draft preserves the next required field. A complete range with missing title must still accept the title after reload.
- [ ] Verify queued voice answers and a late model response cannot overwrite a newer correction; use existing turn-lease/cancellation handling, extending it only if the regression demonstrates a gap.
- [ ] Run `node scripts/eval-chat.mjs`, `node scripts/check-title-confidence.mjs`, `node scripts/check-event-choice.mjs`, and `node scripts/check-schedule-speech.mjs`.
- [ ] Run the new event-draft browser regression and existing `scripts/check-event-choice-ui.mjs` and `scripts/check-voice-ui.mjs` with the existing Playwright setup. Use temporary screenshot paths; do not overwrite unrelated captures.
- [ ] Run `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build`, and `git diff --check` for changed files.
- [ ] Manually review the final Coffee date and Morning walk confirmation cards on phone and desktop. Confirm the calendar remains unchanged until approval, then saves exactly once with the reviewed title and times.
- [ ] Record actual verification results and any unavailable real provider/device checks. Do not claim live-model or microphone testing from mocked external boundaries.

## Completion criteria

The reported sequences reach one correct confirmation card, known fields survive replies/corrections/reloads, model wording cannot reintroduce the missing-field loop, and explicit user titles remain authoritative. Regression cases pin these guarantees to actual draft transitions and UI outcomes. This prevents the demonstrated mechanical failure; it does not promise perfect understanding of every possible utterance.

**Planning status:** Investigation and plan complete. No application implementation changes made for this request.
