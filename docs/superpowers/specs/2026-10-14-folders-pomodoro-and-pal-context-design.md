# Folders, Pomodoro, and Pal context — revised design

Status: implemented in the local feature checkout on 2026-10-14; automated verification and review fixes recorded in the execution ledger. Actual voice preference and physical-device validation remain user/device checks.

## Intent

Make the app behave the way the user expects: control where attachments are filed, restore the familiar flip-and-swipe flashcards, keep a simple Pomodoro with a place to throw away distracting thoughts, make dragged tasks follow the pointer, and give Pal accurate knowledge of tasks, folders, pronunciation, and local weather. Preserve existing folder artwork, paper surfaces, Pomodoro SVG, Pals, light/dark themes, saved files, decks, task notes, and sessions.

This revision supersedes the earlier plan wherever it conflicts: “Cards” becomes “Folders”; “Focus” becomes “Pomodoro”; the distraction bin is now in scope; the visible flashcard experience returns to the original flip card. Existing data is not reset.

## Folders and attachment placement

The Study tabs become **Folders** and **Pomodoro**; the folder page heading is **Folders**. Rename matching Today shortcuts and navigation copy. Internal saved keys may remain `library`/`focus` for compatibility.

On chat attachment selection, ask “Save this file in a folder?” before creating a folder or library file. With no folders, offer **Create folder**, **Keep in chat**, and **Cancel**. With existing folders, ask which folder, showing the existing folder names plus **Create folder**, **Keep in chat**, and **Cancel**. Never silently select or create a folder, even if a filename suggests a subject.

Proposed default: Keep in chat saves a durable unfiled attachment on this device so it can be read and used in the conversation after reload; it does not appear inside a fabricated folder. Provide **Move to folder** later. Cancel saves nothing. Batch attachments use one explicit destination choice for the selected batch and show per-file failures. Creating an empty folder is an explicit user action; failure importing a file must not report it as filed. Existing files retain their current folders.

## Flashcards

Restore the existing layered-paper flip card: tap/click the card to reveal its answer, tap again to show its question. After revealing, swipe right for “I know it” and left for “Not yet”. Add compact equivalent buttons and keyboard controls; normal vertical scrolling remains possible. A swipe before revealing must not record an answer. Cancelled/short/mostly vertical gestures leave the card unchanged.

Remove the newly introduced mode toolbar from the flashcard screen. Reading and Quiz remain separate file actions; keep existing quiz data and reuse a deck when appropriate. Preserve saved learning history for unchanged cards. Missed cards can repeat once later in the round and come first next time. Do not require AI to practice an existing deck. Retain Recall history in storage even though Recall is no longer primary UI.

## Pomodoro and distraction bin

Open the existing ready Pomodoro directly from its tab. Keep Start, Pause/Resume, Finish, round/break controls, and session recovery because they operate the timer. Remove the gallery and “All tools” navigation from new Pomodoro flows; preserve compatibility for older saved active sessions until finished. Preserve the timer illustration and explicit Start.

Beside the timer on a wide screen, and below it on a phone, show a small paper field labeled **What’s distracting you?**, with placeholder **Write it down, then let it go.** and a **Throw away** button using the current trash icon style. Proposed default: keep an unfinished draft locally until discarded; thrown-away text is erased, excluded from AI context, and never converted to a task. A brief paper-to-bin animation provides feedback, with an instant reduced-motion equivalent. Throwing away a thought never starts, stops, or resets the timer. Do not add a history or permanent trash archive.

## Block Yard dragging

The dragged visual is the actual task paper, including title and folder tone, rather than a separate text label. Render it in a body portal so transformed/glass ancestors cannot offset its fixed position. Keep the pointer's original grab offset and update position in viewport coordinates. Original card leaves a placeholder; valid destination highlights. Cancel restores the original position and status. All movement paths share the three-task Workbench limit and existing calendar rules. Keyboard moves retain focus.

## Pal awareness

Pal receives current Block Yard titles, status, due/scheduled times, estimated minutes, linked folder names, and relevant notes; includes tasks without deadlines and recently completed tasks when relevant. Folder context includes actual names, file names, IDs, and counts, refreshed after changes. Relevant file passages are retrieved when a question asks about contents; do not pretend filenames prove the full contents were read. Unfiled attachments remain available to their conversation.

Build this snapshot deterministically from current local records for every turn, before passing it to any selected model. Use relevance selection and a bounded context budget rather than flooding a small model with all notes. Local/offline rules should answer task/folder inventory questions without an AI dependency. Reading context never silently modifies a task or folder. File contents are evidence, not instructions that override the user's request.

## Spoken times

Visible text stays `7 AM`, `4 PM`, and `9:30 PM`. Rei should speak English letter names: **seven A M**, **four P M**, **nine thirty P M**. Current shared normalization writes “ey em” for all Pals; choose a voice/language-specific speech representation so English Rei does not spell “E-Y-A”. Keep Jhyvie's validated Filipino pronunciation separately. Test noon/midnight, ranges, dotted/lowercase forms, browser/native fallback, and the server speech path. Do not change the selected voices unless pronunciation cannot be corrected with the speech text.

## Location and weather

Use the app's existing location capability with an explicit **Use my location** control and a manual city alternative. If permission is already granted, reuse it; do not repeatedly prompt. Show the selected city/area, location source, and forecast update time. Never present Manila fallback as the user's confirmed location.

Cache forecasts by location and timezone, including individual hourly rain probability/time pairs across the suggestion horizon. Do not collapse separated rain hours into one uninterrupted rainy span. Weather advice must cover the actual proposed interval; unavailable, stale, out-of-horizon, or wrong-location forecasts yield a clear “forecast unavailable” qualification. Weather is a planning consideration, not a guarantee. Prefer suitable dry windows for explicitly outdoor activities only when they are also free on the calendar; explain the reason and let the user choose. No automatic rescheduling. Device coordinates go to the weather provider; AI gets an area label and forecast facts, not precise coordinates by default.

## Tagalog travel intent and maps-based transportation

Recognize “aalis kami”, “papunta/pupunta”, “bibiyahe”, and related Tagalog/Taglish travel expressions as transportation intent. For “Aalis kami papuntang Quezon sa October 16”, preserve the user's destination and date instead of generating an event named “Popunta kami Kessons”. Ask **“Anong oras kayo aalis?”** when departure time is missing. If the origin or destination is ambiguous, clarify them before fetching a route: “Quezon” can refer to different places, so ask whether the user means Quezon Province, Quezon City, or another place and which town/address. Do not assume the weather location is the trip's origin without confirmation.

Support Filipino place names, local pronunciation, common aliases and transcription variants through Philippine place-aware matching and map/geocoder candidates. Preserve the raw transcript and show the resolved destination for correction; do not globally replace similar words in unrelated speech. A suspected “Kessons” may be offered as “Quezon”, but cannot become a confirmed place silently. Place context may improve transcription hints where the current provider supports them; it cannot guarantee accurate recognition.

The draft card is labeled **Transportation**, with a title such as **Travel to Quezon**, confirmed origin/destination, travel mode, departure date/time, and estimated arrival/duration. It is a calendar transportation block rather than a generic event or duplicate Block Yard task. Reuse the existing commute category where compatible; distinguish explicit trips from automatically generated routine commutes so calendar cleanup does not delete user-created travel.

Fetch travel duration from an actual routing/maps service using confirmed coordinates and a selected travel mode. Attach source, fetched time, distance and route basis; identify whether traffic is included and whether it supports the requested future departure. A future October 16 departure is not accurately predicted by a current-traffic estimate alone. If the selected service lacks future traffic support, label the result as a baseline route estimate. Driving time is not a bus/commuting estimate; transit/ferry trips require supported data or user input. Traffic, weather and stop delays remain uncertain.

Never let the language model invent duration. If maps is unavailable, permission is denied, the mode/route is unsupported, or the result is stale, say the estimate is unavailable and offer an external maps link or a manually entered duration labeled **Your estimate**. Do not save a false arrival time. Proposed default: hold a dated trip with unknown duration as a pending draft until the user provides/accepts an estimate; no invented-length calendar block. Recompute after origin/destination/mode/departure changes; user confirms before saving or changing a booked trip. Route credentials belong on a backend/proxy if needed, never in client bundles. Exact endpoints are sent to the routing provider for this requested estimate; AI receives place labels and route facts unless precise addresses are needed for the user's question.

## Manual schedules and schedule notes

Add a clearly visible **Add schedule** button to Week/Calendar and a corresponding Today shortcut. It must work offline without speaking to AI. The responsive editor supports title, date, start/end, category (including Transportation), and multiline notes. An existing schedule opens the same editor through **Edit schedule** in its popover/details. Keep Save/Cancel explicit and confirm discarding unsaved edits.

Use the existing CalEvent `note` field for notes. Save updates the selected event ID and leaves unrelated events/tasks intact. Transportation fields can request a route estimate when online but do not require maps for a user-entered schedule. Manual schedules validate end after start, support explicit overnight end dates, and show overlap warnings with a deliberate save-anyway choice. Editing a task-owned block uses the existing task/calendar synchronization rules rather than breaking its link. A stale editor must not overwrite newer AI/calendar edits.

Notes persist after reload and appear in schedule details with readable long-text handling; they enter Pal context only when relevant. A manual schedule does not automatically create a Block Yard task. Keep ordinary notes separate from discarded Pomodoro distraction text. Existing schedule IDs, reminders, recurrence metadata and task links survive edits.

## Verification and defaults

Test on desktop/tablet/phone, short landscape, light/dark, reduced motion, mouse/touch/keyboard, reload, offline, and storage failure. Validate pronunciation with actual audio samples; normalized strings alone do not prove a voice sounds right. Physical-device microphone, touch, and geolocation behavior must be identified separately from browser emulation.

Proposed defaults open to correction: durable unfiled chat attachments; explicit batch destination; locally retained unfinished distraction draft but no discarded history; a 48-hour hourly forecast horizon; 30-minute weather freshness. These are design decisions, not claims of implemented behavior.
