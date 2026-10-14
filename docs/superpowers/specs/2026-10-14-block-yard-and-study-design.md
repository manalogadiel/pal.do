# Block Yard, editable tasks, and Study design

Status: implemented and verified in the local feature checkout on 2026-10-14. See the implementation plan and execution ledger for evidence and physical-device testing limits.

## Purpose and navigation

Make everyday tasks editable without chatting with Pal, and give each study tool one clear job. Block Yard replaces the current Tasks page. Focus and Cards stay under Study; subject folders remain the entry point for study materials. Today retains its agenda and gains compact shortcuts to those three destinations. Keep Pal chat, Week, reminders, and existing data.

## Visual authority

Use the application's existing folder tabs, layered paper, subject colors, SVG instruments, pixel Pals, typography, and light/dark themes. Match new task and card artwork to those assets. The reference document supplies functional ideas; the user explicitly prefers the current visual design and Pomodoro. Core graphics must work offline. AI image generation, a new purple palette, and a replacement Pomodoro are outside this release.

## Tasks and Block Yard

- Quick-add requires a task title only and works without AI or internet.
- Opening a task exposes title, multiline plain-text notes, status, optional deadline, optional estimated duration, optional scheduled start/end, and optional subject folder.
- Save edits explicitly; retain drafts while the editor remains open and ask before discarding unsaved changes. Store committed notes locally with the task.
- Deadline and scheduled time are separate. A deadline may have an existing deadline marker; an unscheduled everyday task creates no calendar work block.
- A scheduled task owns one identifiable calendar block. Moving or removing its schedule changes that block, not unrelated events. Finishing it completes that block. Estimated duration alone does not place it in the calendar.
- Existing exam/assignment deadlines, study blocks, and focus-time history remain intact. Completing an everyday task is distinct from logging study hours.
- Zones: Pile, Workbench, Done. Workbench permits at most three tasks. Completion history forms a day-grouped wall rather than a streak counter.
- Pointer dragging is optional convenience; Move to Workbench, Return to Pile, Complete, and Reopen controls provide equivalent touch and keyboard actions. A fourth active task is refused with a clear explanation.
- Task block width reflects estimates within usable minimum/maximum sizes; missing estimates use a neutral size. Titles stay legible and notes have an affordance.
- Proposed first-release default: a doing task cools visually after 30 minutes without deliberate interaction. Cooling never changes status or sends notifications.
- Desktop shows three zones and a task detail side panel. Tablet reflows the board; phone uses zone tabs and a full-screen editor. No required horizontal dragging or clipped dialogs.

## Focus and Pomodoro

Preserve the existing Pomodoro SVG, timer, controls, round/break behavior, explicit Start, and saved sessions. Remove its goal field and bypass the setup questionnaire. Opening it from a folder retains that folder context. The pasted document's alternative timer, automatic-break, and brain-dump requirements do not apply to this Pomodoro change.

Replace the six-tool gallery with clear Focus and Cards destinations. Continue rendering already-saved sessions from older timer methods so migration never discards an active session; those methods need not remain primary navigation choices.

## Cards and folders

Keep current folder artwork, files, reading, imports, and deck generation. A selected deck offers Swipe, Recall, and Quiz tabs:

- Swipe: flip, then know/not yet through gestures or buttons.
- Recall: type an answer, reveal the source answer, then self-mark.
- Quiz: choices from the same deck, with a score at the end. Insufficient distinct answers gets an explanatory fallback to Recall rather than invented choices.
- All modes update one persisted per-card history. Missed cards return sooner. Proposed initial scheduler: missed cards repeat once later in the current mode and receive priority next session; rounds remain bounded.
- Full round optionally runs Swipe, Recall, then Quiz.
- Preserve progress for unchanged cards; regenerated/changed content must not inherit the wrong card's history.

## Delivery boundaries and evidence

Deliver independent phases: task model/editor, board/calendar synchronization, Pomodoro shortcut, unified Cards, then navigation and responsive finishing. Each phase must work independently and preserve existing localStorage and IndexedDB records. Sticky-note appearance, custom AI artwork, cloud sync, social features, and brain dump are deferred.

Verify migrations, offline operation, reload persistence, calendar synchronization, three-slot limits, duplicate submissions, card identity, keyboard controls, reduced motion, and phone/tablet/desktop layouts. Physical device/keyboard checks must be reported separately from browser emulation.
