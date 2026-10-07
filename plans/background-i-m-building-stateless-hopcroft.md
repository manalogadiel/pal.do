# Plan: Pal.Do big UI revamp ("Pal Room")

## Context
The user asked for a "big UI revamp" after the Soft Liquid pass. Right now the layout is a chat window and a week grid side by side. That makes the pal feel like a sidebar widget, and the week grid is dense for a student's quick check.

The revamp makes the pal the heart of the app and gives the calendar its own clear space. The product logic doesn't change: `turn()` in lib/agent.ts, `propose()` in lib/schedule.ts, the reminders, and the guardrails.

## Direction (user picked A)
- **Layout:** a pal-first home: a big pal stage plus today's agenda. The week calendar moves to its own view.
- **Visual style:** keep the current Soft Liquid look (palette, glass, fonts). Only the layout and hierarchy change.

## Part 1: Fix the agent, mic and voice first (user-reported bugs)

### "I have 9-12am class" isn't added
These are the causes, found in `src/lib/parse.ts` and `src/lib/agent.ts`:
1. **12am is read as midnight.** `parseRange` turns "12am" into hour 0. The class then ends before it starts (9 → 0), so the function returns null and the agent falls through to the "unknown" reply.
2. **Ranges with no am/pm at all are ignored.** "9-12" and "9 to 12" don't match the `RANGE` regex, because it requires am/pm on the end time.
3. **A half-finished task swallows the class.** If a draft is waiting for its due date, the slot-filling step runs before the event check. "9-12am class" then becomes that draft's due date instead of a new event.
4. **Classes have no recurrence.** Students say "MWF 9-12 class" or "every Tuesday". Without a day, the event lands on today only.

Fixes:
- **`parseRange`:**
  - If the end comes out at or before the start, try adding 12 hours to the end. So 12am becomes noon when it follows 9am, and "1-3" becomes 1–3pm.
  - Allow ranges with no am/pm. Guess with school hours: a start between 7 and 11 means am; a start between 1 and 6 means pm.
  - Support "from 9 to 12" and "9am-12nn" ("nn" means noon).
- **New `parseDays(text)`:** returns a list of weekdays from:
  - MWF, TTh, M/W
  - "every Mon"
  - "Mon and Wed"
  - "daily" and "weekdays"
- **Agent:**
  - The check for a time range plus an event kind (`eventKind`) runs **before** slot filling, so the class becomes its own event and the draft keeps waiting.
  - A class or shift with no day asks a follow-up: "Which days? (e.g. MWF)", with chips for MWF, TTh, Daily and Just today. This uses a new `awaiting: 'days'` value and a pending event.
  - `Action addEvent` gains `days?: number[]`. In App.tsx, `onCard addEvent` creates one event per day for the rest of the semester view (8 weeks), all sharing a `seriesId`. The event read-back shows "Mon, Wed, Fri · 9am – 12pm".
- **More phrasing:**
  - "I have class 9-12", "class from 9 to 12", "9-12 class"
  - "my shift is 2-8"
  - "lab 1pm to 4pm on thursday"
  - Taglish "may klase ako 9-12"
- **Regression table:** a pure `src/lib/parse.test-cases.ts` list of inputs and expected outputs. A dev-only `?selftest` query param runs it and logs any failures to the console. Test frameworks can't be installed here, so this is the check.

### Mic and voice not working
Likely causes:
- The Figma Make preview is an iframe. Unless it has `allow="microphone"`, speech recognition fails with `not-allowed`.
- The app currently swallows every error silently (`onerror → setMicOn(false)`).
- The voice toggle defaults to off.
- Chrome's speech engine loads its voice list late, and a long utterance can pause midway.

Fixes in `App.tsx` `toggleMic`/`speak`:
- **Show the real error:** a toast plus a pal line, `alarmed`. For `not-allowed`: "Mic is blocked in this preview. Open the app in a new tab and allow the microphone." with an "Open in new tab" button (`window.open(location.href)`). Also messages for `no-speech`, `audio-capture` and `network`.
- **Live transcript:** `interimResults: true`, so words appear in the composer as they're spoken. Send on the final result. Use the language `navigator.language || 'en-US'`, and fall back to en-US if `en-PH` fails.
- **Mic control:** call `getUserMedia({audio:true})` first. This brings up a clear permission prompt and lets us detect a block early. Then release the stream.
- **Spoken replies:**
  - Wait for `voiceschanged`, and choose an English voice for each pal.
  - Work around Chrome's long-utterance stall with `cancel()` before each reply and a `resume()` keep-alive every 10s.
  - Turn the mouth on and off from `onboundary` events.
  - The first tap on the mic turns voice on, so a voice conversation works both ways.
- **Unsupported browsers** (Firefox/Safari without SR): the mic shows a disabled state with a tooltip, instead of being hidden.

## Part 2: UI revamp

## Layout
**Desktop.** Three zones, on the same mist canvas:
1. **Left rail (72px), a glass pill.** It holds the wordmark dot and three views (Home, Week, Tasks), with settings and syllabus at the bottom. Views switch with a crossfade and a slight shift (Emil-style easing).
2. **Home.** On the left, the **Pal stage**:
   - a large pal, about 180px tall
   - the speech bubble
   - the conversation, with a pinned composer and the mic orb
   On the right, a **Today column**:
   - a big serif date
   - "Now / Next" focus slabs with a countdown
   - today's agenda as a vertical timeline of pastel pills
   - a week load strip
   - upcoming deadlines with progress rings, based on doneHours/hours
3. **Week.** The existing `Calendar` at full width. The chat collapses to a floating pal bubble (the ⌘/ behaviour that already exists), which opens as a popover chat.

**Tasks.** A new, simple list of tasks with:
- the due date
- a progress ring
- a "Plan it" button, which sends a message through the existing `send()`

**Mobile.** A bottom tab bar (Home, Week, Tasks), with the floating composer and the pal above it.
- **Home:** Today first, with the chat drawer.
- **Week:** day view.

## Visual
- **Bigger type scale:** a 56px serif date, a 22px section title, and 15px body text.
- **Surfaces:** "Now" slabs use the event's pastel with a large radius (24px); everything else sits on glass. There are still no borders.
- **The pal gets a "room":** a soft radial spotlight behind it and a floor ellipse shadow. Its time-of-day tint shifts between morning, afternoon and night.
- **Motion:**
  - Elements on Home slide in with a staggered fade.
  - Progress rings animate with a stroke-dashoffset transition.
  - Tab switches have an animated indicator (the active pill slides).
  - Reduced-motion fallbacks.

## Files
- `src/App.tsx`:
  - a `view` state ('home' | 'week' | 'tasks'), persisted
  - the rail or tab bar shell
  - Today data derived from `events`/`tasks`, reusing the logic in `summary()`
- **New** `src/components/Today.tsx`: date header, Now/Next, agenda timeline, deadlines with `Ring`.
- **New** `src/components/Tasks.tsx`: the task list.
- **New** `src/components/Nav.tsx`: the rail (desktop) and tab bar (mobile).
- `src/components/Chat.tsx`:
  - a `stage` size prop for the bigger pal
  - a spotlight and floor behind the pal
  - a popover mode for the Week view
- `src/components/Calendar.tsx`: only small spacing changes for full width; `LoadStrip` is reused in Today.
- `src/index.css`:
  - spotlight and time tints
  - a `.slide-in` stagger
  - ring transition
  - tab indicator
- **Reuse:**
  - `fmtTime`/`fmtDay`/`fmtHours`/`hoursOf` (lib/core.ts)
  - `Pal` (pals/Pal.tsx)
  - `Glyph`/icons (components/Icons.tsx)
  - `BlockPopover` (Overlays.tsx)

## Verification
- Agent:
  - "I have 9-12am class" asks which days; tapping MWF puts the Mon/Wed/Fri 9–12 blocks on the calendar.
  - "shift sat 2-8" adds the shift directly.
  - "class 1-3 tuesday" becomes 1–3pm.
  - The `?selftest` cases all pass.
- Mic:
  - In the Make iframe it shows the blocked-mic message with "Open in new tab".
  - In a new tab, speaking fills the composer live and the message sends.
  - With voice on, the reply is spoken and the pal's mouth moves.
- Check at 1440×900, 1280×720 and 390×844:
  - the composer and mic are visible on Home
  - all taps work, so no overlay layer blocks pointer events
- Demo flow still works: onboarding → "Bio exam Friday" → read-back → proposal (blocks flash on Week) → accept (happy) → +1d → check-in → done (cheer).
- Tasks → "Plan it" opens the conversation with a proposal.
- Light and dark mode, and reduced motion.
