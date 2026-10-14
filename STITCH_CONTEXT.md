# Project Context: Chronos — Student Time & Study Companion
> **Context Specification for UI/UX Redesigning & Prototyping (Google Stitch / Figma / Design AI)**

---

## 1. Executive Summary & Brand Identity

- **App Name:** **Chronos** *(formerly Pal.Do)*
- **Product Tagline:** Personal AI Time & Study Companion for Busy College Students
- **Target Audience:** College students (especially non-traditional & working students) who balance heavy academic coursework with part-time jobs, freelance raket, student organization leadership, commuting, and personal responsibilities.
- **Core Philosophy:** **"AI Proposes, Student Decides."**
  - **Not a passive to-do list:** Static lists fail because student schedules are volatile; when plans break, students abandon passive planners.
  - **Not a black-box autonomous scheduler:** Automated AI that secretly alters calendars causes anxiety, missed classes, and double bookings.
  - **A collaborative companion:** The AI negotiates schedules in natural Taglish/English, detects timetable clashes, suggests realistic study blocks on interactive proposal cards, and lets the student confirm, revise, or decline before anything touches storage.
- **Tone of Voice:** Empathetic, supportive, calm, direct, and youthful (Taglish-aware, conversational Filipino/English context).

---

## 2. Visual Design System & Aesthetics

### 2.1 Aesthetic Theme: Modern Calm & Atmospheric Glass
- **Inspiration:** Linear, contemporary Swiss UI, modern macOS/VisionOS frosted glass.
- **Design Directives:**
  - **Strictly Anti-AI Slop:** No generic gradient purple glows, no cliché warm-cream editorial serif fonts (e.g., Instrument Serif removed), no decorative gimmickry.
  - **Atmospheric Frosted Glass:** Translucent, milky liquid panels (`backdrop-filter: blur(28px)`) floating over a subtle, living sky gradient.
  - **Low Cognitive Load:** Generous breathing room, clear typographic hierarchy, punchy copy, and zero walls of text.

### 2.2 "Time of Day" Color Palette
A cohesive palette inspired by the changing sky from dawn to twilight:

| Role | Color Name | Hex Code | Usage |
| :--- | :--- | :--- | :--- |
| **Canvas Base** | Lilac Alabaster | `#e4dce8` | Background wash, ambient undertone |
| **Primary Ink** | Midnight Slate | `#232538` | Primary text, titles, high-contrast buttons |
| **Secondary Ink** | Dusk Indigo | `#54597d` | Subheaders, active labels, icons |
| **Muted Ink** | Slate Heather | `#757b9c` | Timestamps, secondary metadata, borders |
| **Dawn Highlight** | Dawn Periwinkle | `#b4c4ec` | Active state indicator, focus pill, morning aura |
| **Twilight Accent** | Twilight Mauve | `#9b7a9f` | Primary brand accent, mascot buttons, progress ring |
| **Glass Surface** | Frosted White Glass | `rgba(249, 247, 252, 0.64)` | Floating panel backgrounds (`.liquid`) |
| **Hairline Border** | Subtle Divider | `rgba(35, 37, 56, 0.08)` | Ultra-fine card separation lines |

#### Nocturne (Dark Mode) Tokens
- **Dark Canvas:** `#11121d` (Deep midnight slate)
- **Dark Surface:** `#181a29` (Midnight card base)
- **Dark Glass:** `rgba(23, 25, 39, 0.70)` with periwinkle/mauve diffuse aura
- **Dark Ink:** `#f1eef3` (Crisp chalk white)
- **Dark Ink Muted:** `#b3b7d1` / `#787c9b`

### 2.3 Event Category Semantic Tints (Pill Capsules)
Instead of distracting saturated rainbow colors, categories use harmonious pastel fills:
- **Class:** Periwinkle Tint (`#dbe5f8` / Ink: `#1f3560` / Rule: `#6f8fd4`)
- **Shift / Work:** Lilac Mauve Tint (`#eae1ed` / Ink: `#46314c` / Rule: `#9c83a4`)
- **Exam / Quiz:** Twilight Blush Tint (`#f2dbe4` / Ink: `#5d233e` / Rule: `#c27a98`)
- **Commute:** Sand Muted Stripes (`#e6e2ee` / Ink: `#3c3450` / Rule: `#8b7ea3`)
- **Study / Focus Block:** Soft Paper Tint (`#f8f6fb` with Mauve Edge)
- **Deadline / Due Date:** Solid High-Contrast Badge (`#232538` with Chalk Text)

### 2.4 Typography
- **Primary Sans:** `Inter Tight` (or `Manrope`), `-apple-system`, `system-ui`.
  - Headers: Heavy weight (`font-bold`), negative tracking (`tracking-tight` / `-0.035em`).
  - Body: Medium/Regular, clean line-height.
- **Numbers & Clocks:** Tabular Numerals (`font-variant-numeric: tabular-nums` / `tnum`) for timers and schedule times.
- **Retro Stamps (Folder Badges):** `Silkscreen` / Pixel font for physical library folder stickers.

### 2.5 Component & Corner Radius Rules
- **Panels & Screen Containers:** `rounded-[30px]` or `rounded-[26px]`
- **Interactive Cards (Now/Next, Tasks):** `rounded-2xl` (16px) with soft inner edge lighting (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.9)`)
- **Timeline Events & Buttons:** Smooth pill capsules (`rounded-full`) with soft drop shadow (`shadow-[0_1px_3px_rgba(35,37,56,0.04)]`) — **No awkward boxy border chops**.
- **Action Chips & Badges:** `rounded-full`, compact height (32px - 36px).

---

## 3. Screen-by-Screen Information Architecture

### Screen 1: Today (Home / Daily Command Center)
The primary cockpit students open in the morning or between classes.
1. **Atmospheric Canvas:** Fixed ambient `.mist` element drifting behind frosted glass.
2. **Hero Mascot Stage:**
   - Central animated companion persona (Rei, Diel, Jhyvie, or Jaypee).
   - Dynamic soft spotlight behind the mascot that shifts with the time of day:
     - Morning: Dawn Periwinkle glow (`#d8e3fb`)
     - Afternoon: Twilight Lilac glow (`#ebdce7`)
     - Night: Deep Dusk Indigo glow (`#d8d2ea`)
   - Quick action pill: *"Chat with {palName}"*.
3. **Date & Daily Summary Header:**
   - Date: Large modern bold typography (e.g. `Wed, Oct 14`).
   - One-line status: `{N} events left · about {X}h remaining` or *"All clear today. Rest and recharge."*
4. **"Now / Next" Contextual Cards (Grid 2-col on Tablet/Desktop, Stacked on Mobile):**
   - Active event badge with pulsating live indicator dot (`Now · 35m left`).
   - Upcoming event countdown (`Next · in 1h 20m`).
   - Mini progress bar for elapsed event time.
5. **Timeline Schedule Agenda:**
   - Left-aligned timestamp column (`09:00 AM`).
   - Vertical timeline connector line.
   - Smooth `rounded-full` capsule buttons displaying event title, location/note, duration, and glyph icon.
6. **Week Glance Load Strip:**
   - 7-day mini horizontal bar showing academic workload distribution and dots for deadlines.
7. **Upcoming Deadlines List:**
   - Compact cards for impending assignments or quizzes due within 72 hours.

---

### Screen 2: Week (Timetable & Calendar Grid)
For planning ahead and visualizing schedule density.
1. **Top Bar Controls:**
   - Week switcher (`< Prev Week` / `Next Week >`), simulation toggle, and active day chips.
2. **24-Hour Timetable Grid:**
   - Earliest class start detection (auto-scrolls to first morning event, e.g., 6:00 AM).
   - Red/Accent horizontal live-time indicator line across the current day.
   - Non-overlapping column clustering: simultaneous commitments render side-by-side cleanly.
   - Distinct hatch/stripe patterns for travel/commute blocks.
3. **Ghost / Proposal Overlays:**
   - When the AI suggests study blocks, they render as translucent dashed ghost cards on the calendar for review before confirmation.

---

### Screen 3: Tasks (Exams & Deliverables Management)
Tracks what needs to get done without feeling like a boring spreadsheet.
1. **Header:** Title + subtitle (*"Exams and deliverables"*).
2. **Quick Ingest Chips:** Common student prompts for one-tap entry:
   - `+ Math quiz next Tuesday`
   - `+ History essay due Friday`
   - `+ Paste my syllabus`
3. **Task Cards List:**
   - Circular progress ring (`Ring`) indicating logged study hours vs. estimated hours needed.
   - Category glyph (exam cap or briefcase icon).
   - Due date indicator with amber warning badge for deadlines in `< 48 hours`.
   - Planned blocks counter (`Next block Thu 2:00 PM · 2 planned`).
   - Action buttons:
     - `Plan` (if no blocks exist)
     - `Re-plan` (if life changed and blocks need redistributing)
4. **Done & Past Due Accordions:** Foldable archive of completed work.

---

### Screen 4: Study (Focus Timer & Review Library)
Where actual learning takes place.

#### Subsection A: Focus (Pomodoro Timer)
- **Clean Digital Clock:** Huge 72px bold tabular clock digits (`25:00`).
- **Phase Label:** *"Focus session"* / *"Short break"* / *"Paused"*.
- **Round Progress Dots:** 4 discrete session indicator dots showing current round.
- **Minimalist Control Pills:** `Start`, `Pause`, `Resume`, `Skip`, `Stop`.
- **Sound Alert Toggle:** Subtle toggle for ambient chime completion alarms.
- **Companion Feedback Bubble:** Mascot stands below timer with context-aware micro-encouragements.
- **Daily Stat:** *"Today: 50m focused"*.

#### Subsection B: Review Library (Subject Folders)
- **Physical Skeuomorphic-Modern Folder Shelf:**
  - Subject folders rendered with card stock tabs, paper textures, and stepped pixel label stickers (e.g. `BIO`, `MATH`, `ENG`).
  - Dynamic paper sheets peeking out from folder tabs representing file count.
- **In-Folder Document View:**
  - Tab switch: `Read` (built-in PDF/Text reader) | `Cards` (interactive flashcards) | `Quiz` (practice quiz player).
  - Voice-assisted reading: Pal reads lecture notes aloud using native TTS.
  - Interactive quiz runner with instant answer validation, feedback hints, and score tracker.

---

### Screen 5: AI Companions & Conversational Panel (Chat)
The interactive brain of Chronos.

#### The 4 Companion Personas
1. **Rei:** Calm, structured, analytical, supportive big sister energy.
2. **Diel:** Witty, direct, pragmatic, hyper-efficient productivity peer.
3. **Jhyvie (JV):** Warm, bubbly, encouraging, expressive Taglish companion.
4. **Jaypee:** Chill, reassuring, patient, low-stress study buddy.

#### Conversational UI Elements
1. **Stage & Speech Bubble:** Mascot stands atop the input composer with a compact cartoon speech bubble.
2. **First-Run Empty State:**
   - Punchy greeting: *"What's on your plate today?"*
   - Contextual suggestion chips: `Bio exam Friday`, `Shift Sat 2-8pm`, `How's my week?`, `Import syllabus`.
3. **Interactive Proposal Cards (`Card` / `PendingEvent`):**
   - The critical UI element of the app.
   - When user says *"Gym bukas 6pm"*, the AI does **NOT** secretly write to the database. It renders a floating Proposal Card:
     - Event Title & Kind badge
     - Proposed Start & End Time
     - Conflict Warning (if overlapping with another event: *"Clashes with 5:30pm Dinner"*)
     - Action Buttons:
       - **[Confirm / G!]** (Applies change to calendar)
       - **[Revise]** (Opens time edit)
       - **[Skip / Wag na]** (Dismisses proposal)
4. **Composer Row:** Attachment button (PDF, text notes, syllabus images), multiline input box, push-to-talk mic, hands-free indicator chip.

---

### Screen 6: Overlays & Onboarding Modals
1. **Pal Selector Carousel:** Swipeable interactive carousel to preview avatars, tones, and greetings.
2. **Ground Rules Sheet:** Transparent privacy declaration:
   - Calendar stays 100% on-device.
   - AI sends sanitized daily schedule summaries only when answering queries.
   - Nickname input (*"What should your pal call you?"*).
   - Energy peak selector: Morning / Afternoon / Evening.
3. **Syllabus / Bulk Ingest Sheet:** Text area to paste course syllabi, semester schedules, or shift rosters for automated multi-event extraction.

---

## 4. Key UX Guardrails & Principles for Redesign

1. **Human-in-the-Loop Always:** Never design a UI where the AI acts as an invisible decision maker. Every schedule write, delete, or reschedule must have an explicit visual approval card or confirmation state.
2. **Graceful Offline Degradation:** The UI must visually reflect offline capability. The primary calendar, tasks, timer, and rules engine work with zero internet; only cloud PDF synthesis displays an online badge.
3. **Anti-Stress Aesthetics:** Avoid aggressive reds or harsh alerts. Missed tasks or conflicts are flagged with calm amber tones (`#755f88` / `#8b7ea3`), treating schedule disruptions as routine life events rather than failures.
4. **Touch & Ergonomics:** All primary interactive buttons must have a minimum touch target of 44x44px, with floating bottom navigation accessible via thumb zones on mobile.

---

## 5. Summary Prompt for Google Stitch / AI Generation

```text
Design a modern, minimalist mobile & desktop web application named "Chronos" — a personal AI study and time companion for college students. 

Aesthetic Style:
- Inspired by Linear and contemporary Swiss UI with VisionOS-style frosted glass surfaces.
- Strictly NO generic purple AI glows or cliché serif editorial fonts.
- "Time of Day" color palette: Calm Lilac Alabaster (#e4dce8) background with Dawn Periwinkle (#b4c4ec), Twilight Mauve (#9b7a9f), and Dusk Indigo (#54597d) accents.
- High-contrast, razor-sharp typography using Inter Tight with tight letter tracking.
- Translucent frosted glass panels (backdrop blur 28px) with subtle edge lighting floating over an ambient sky mist.
- Rounded pill capsule buttons (rounded-full) with delicate shadows.

Key Interfaces to Showcase:
1. Daily Dashboard (Today View): Hero mascot stage with soft time-of-day spotlight, date header, Now/Next focus cards, and a vertical timeline agenda of classes, study blocks, and work shifts in tinted pill capsules.
2. Conversational Planner with Proposal Cards: Chat interface where an AI companion suggests schedule blocks. Highlights an interactive "Proposal Card" with conflict detection and explicit "Confirm", "Revise", and "Skip" action buttons.
3. Study Mode: A clean, distraction-free Pomodoro focus timer with large tabular digits (25:00), circular progress dots, and an integrated subject review library with stylized paper folders.
```
