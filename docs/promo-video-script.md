# Pal.do — 60-second promo: script, AI lines, and shot list

**Concept:** *"Kahit tulog ka, gising ang Pals mo."*
Jon Paul (JP) is buried in work and falls asleep at his desk. Rei, Diel, Jhyvie and Jaypee climb out of his phone, hype him up, and wake him with an alarm. Then he takes control **by talking to his Pals**, and every feature appears as a real screen recording plus a motion graphic.

**Rule for the edit:** every feature = **real app footage** (proof) + **motion graphic** (wow). Never fake UI. The motion graphics are built from the real screen recording: cut-out cards, zooms, and UI pieces flying out of the phone into the room.

---

## The 4 Pals (from `src/pals/Pal.tsx`)

| Pal | Look | Personality | Presents in the video |
|---|---|---|---|
| **Rei** | Lavender round head, orange plus antenna | Direct and clear, answer first | Schedule, deadlines, study plan |
| **Diel** | Mint robot head with a screen face | Calm and gentle | Focus timer, insights, rest |
| **Jhyvie** | Peach rabbit, pink-lined ears | Your Tagalog friend | Shopping, travel, weather (life stuff) |
| **Jaypee** | Yellow chick, blue cap | Playful and funny | Alarm, reminders, flashcards and quiz |

Their animation states already exist in the app: `idle, listening, talking, sleeping, alert, alarmed, shocked, happy, wave, cheer`. Use them as the Pals' poses in the composite. Logo art: `public/brand/paldo-pals.png`.

---

## Every feature, and where it shows up

| # | Feature | How it's shown | Time |
|---|---|---|---|
| 1 | Alarm / reminders with Pal's alert sound | Story: the wake-up scene | 0:21 |
| 2 | **"Hi Jhyvie" wake word**, hands-free, on-device | Hero demo D1 | 0:24 |
| 3 | Instant schedule answers ("anong sched ko bukas?") + **Today** view | D1 | 0:24 |
| 4 | **AI recommends a time** + **Proposal card** (Confirm / Revise / Skip) + clash check | D2 | 0:28 |
| 5 | **Travel planner** (route time) + **weather** | D3 | 0:32 |
| 6 | **Plan my study**: ghost blocks on **Week** + **Block Yard** progress rings | D4 | 0:35 |
| 7 | Voice reminders and timers ("remind me 30 min before…") | D5 | 0:39 |
| 8 | **Study focus timer**: Pomodoro, Flowtime, 52/17, Eat the Frog, Custom + Distraction bin | D5 | 0:39 |
| 9 | **Review Library**: folders, Pal reads aloud, **flashcards**, **quiz** | D6 | 0:42 |
| 10 | **Import class schedule** from a photo/PDF/DOCX | D7 | 0:46 |
| 11 | **Insights** ("am I overloaded?") + best next step | D8 | 0:49 |
| 12 | Choose your Pal, nickname, energy peak (onboarding) | Speed-run | 0:51 |
| 13 | Floating companion (desktop picture-in-picture) | Speed-run | 0:51 |
| 14 | Dark mode, offline-first, private, Android app, Pal voice | Speed-run | 0:51 |

> Too much for 60s? Make a **90s version**: same structure, but each hero demo gets 5–6s instead of 3–4s. Shoot everything below once and you can cut both versions.

---

## Full script

### ACT 1 — CHAOS (0:00–0:06)
| Time | Visual | Effects | Audio |
|---|---|---|---|
| 0:00–0:02 | Top-down: messy desk, laptop, papers, 3 coffee cups, phone buzzing | Speed ramp in, rotate transition | Clock ticking |
| 0:02–0:04 | Close on JP's eyes darting / rubbing his face | Zoom punches on the beat | Notification pings stacking |
| 0:04–0:06 | Wide: overwhelmed JP, clock reads 2:47 AM | Kinetic text around his head: *"Bio quiz"*, *"Org report"*, *"Shift Sat"*, *"Thesis Ch.3"* | Beat stops |

### KNOCKOUT (0:06–0:09)
| 0:06–0:09 | Head drops onto the desk; the phone beside him lights up by itself | Slow-mo, desaturate, vignette, glow bloom | Muffled sound → shimmer |
|---|---|---|---|

### ACT 2 — THE PALS (0:09–0:17)
Each Pal pops out of the phone (stretch-and-squash + sparkle) and lands somewhere real, with a shadow, a name card, and their trait from the app.

| Time | Pal | Where they land | Line (VO, in the Pal's app voice) |
|---|---|---|---|
| 0:09–0:11 | **Jaypee** *(wave)* | On the coffee cup | "Uy, knockout na si boss!" |
| 0:11–0:13 | **Diel** *(idle)* | Sitting on the paper stack | "Pagod ka lang. Hindi ka talo." |
| 0:13–0:15 | **Rei** *(alert)* | Peeking from behind the laptop | "Bio quiz. Bukas. 1 PM." |
| 0:15–0:17 | **Jhyvie** *(happy)* | Pokes JP's cheek | "Gising na, kami bahala sa'yo!" |

### INTO THE PHONE + ALARM (0:17–0:24)
| Time | Visual | Effects | Audio |
|---|---|---|---|
| 0:17–0:19 | The Pals dive into the phone | Streak trails, camera **flies through the screen** | Whoosh |
| 0:19–0:21 | Inside: real **Today** screen, deadlines flying at the camera | 3D parallax UI layers | Rei: "Report — 9 AM." |
| 0:21–0:22 | Real **reminder notification** fires, Pals in `alarmed` state | Screen shake, flash | **Pal.do alert sound**, all: "JON PAUL!!" |
| 0:22–0:24 | JP jolts awake, paper stuck to his face | Color snaps back, impact frame | Record scratch → **MUSIC DROP** |

### ACT 3 — TAKE CONTROL: hero demos (0:24–0:51)
JP talks to his Pals **by voice**. Each demo = (A) JP saying the line on camera → (B) real screen recording of the answer → (C) a motion graphic of the key UI flying into the room.

---

**D1 — Wake word + "what's my schedule?" (0:24–0:28)** · Pal: **Jhyvie**
- **JP says:** **"Hi Jhyvie, anong schedule ko bukas?"**
- **App:** wake chime + "Yes?", then lists tomorrow's plans instantly and speaks them aloud.
- **Motion graphic:** a sound-wave ring pulses out of the phone when he says "Hi Jhyvie" + label **"Hands-free. On-device."** Then tomorrow's timeline pills (class, shift, quiz) slide out of the phone and stack in the air beside JP.

**D2 — "I want to go shopping tomorrow" (0:28–0:32)** · Pal: **Jhyvie**
- **JP says:** **"I want to go shopping tomorrow, what time do you recommend?"**
- **App:** suggests a free slot that fits between his commitments and shows a **Proposal card** (title, time, clash warning if any) with **Confirm / Revise / Skip**.
- **JP taps Confirm.**
- **Motion graphic:** the timeline from D1 reappears with a glowing gap; the proposal card drops *into* that gap with a satisfying snap. Label: **"AI proposes. You decide."**

**D3 — Travel + weather (0:32–0:35)** · Pal: **Jhyvie**
- **JP says:** **"Papunta ako sa SM Megamall bukas ng 2PM."** *(use a real place near you)*
- **App:** Travel planner opens with the route and travel time.
- **Motion graphic:** a pixel route line draws from his house pin to the mall pin, with a floating travel-time chip + weather chip (e.g., rain chance) from the Today screen.

**D4 — "Plan my study" (0:35–0:39)** · Pal: **Rei**
- **JP says:** **"Plan my study for my bio quiz."**
- **App:** dashed **ghost blocks** appear on the **Week** grid as proposals; confirm → they become real. Then **Block Yard** shows the task with its progress ring.
- **Motion graphic:** the week grid tilts into 3D perspective; the ghost blocks fly in and lock into place one by one; the progress ring fills.

**D5 — Reminder + focus timer (0:39–0:42)** · Pal: **Diel**
- **JP says:** **"Remind me 30 minutes before my quiz."** Then: **"Start a 25-minute focus timer."**
- **App:** reminder confirmed; the **Study** timer starts at 25:00; the timer pill floats on top.
- **Motion graphic:** the method cards (**Pomodoro · Flowtime · 52/17 · Eat the Frog · Custom**) fan out like playing cards, Pomodoro gets picked; the huge 25:00 digits pop off the screen and hover over JP's desk while he works. A distracting thought gets typed into the **Distraction bin** and crumples away.

**D6 — Review Library: flashcards + quiz (0:42–0:46)** · Pal: **Jaypee**
- **JP says:** **"Quiz me on chapter 3 of my bio reviewer."** *(or "Gawan mo ako ng flashcards from my bio reviewer.")*
- **App:** the subject folder opens → **Read** (Pal reads aloud) → **Cards** → **Quiz** with instant feedback.
- **Motion graphic:** the pixel-sticker folders (BIO, MATH, ENG) slide out like a real shelf; flashcards flip in mid-air; a correct answer = Jaypee `cheer` + "+1".

**D7 — Import class schedule (0:46–0:49)** · Pal: **Rei**
- **JP does:** takes a photo of / attaches his class schedule (image, PDF or DOCX).
- **App:** review rows of extracted classes → confirm → the whole week fills up.
- **Motion graphic:** a scan line sweeps across the paper; class names lift off the paper and fly into the Week grid.

**D8 — Insights (0:49–0:51)** · Pal: **Diel**
- **JP says:** **"Am I overloaded this week?"**
- **App:** answers from the calendar (e.g., heavy day, short sleep, no break) with one suggestion chip.
- **Motion graphic:** the week load strip turns into a bar chart, with the heaviest day pulsing in amber; Diel gives a calm thumbs-up.

### SPEED-RUN — "and more" (0:51–0:55)
A rapid grid, about 0.5s per tile, on the beat. Each tile is a 1-second clip of the real app:
**Choose your Pal** (carousel) · **Nickname + energy peak** · **Floating companion on desktop** · **Dark mode** toggle · **Pal reads your notes aloud** · **Best next step** card · **Works offline / your calendar stays on device** · **Android app**
Effect: tiles pop in a 3×3 grid, then zoom out to reveal they form the Pal.do logo.

### END CARD (0:55–1:00)
| 0:55–0:57 | Clean desk, sunrise light, JP stretches; all 4 Pals on his shoulder/desk in `cheer` | Warm grade, lens flare | Jaypee: "See? Hindi ka nag-iisa." |
|---|---|---|---|
| 0:57–1:00 | Logo (`paldo-pals.png`) + **Pal.do** + tagline + where to get it | Pals bounce into the logo | VO: **"Pal.do. Your pals for getting it done."** *(alt: "May kasama ka na sa deadlines.")* |

---

## Everything JP says to the AI (record these exactly)

Say each line **3 times**: on camera (for lip sync) **and** into the real app during the screen recording (so the answer is real).

| # | Line | Pal | Expected result in the app |
|---|---|---|---|
| 1 | "Hi Jhyvie, anong schedule ko bukas?" | Jhyvie | Wakes, lists tomorrow's events, speaks them |
| 2 | "I want to go shopping tomorrow, what time do you recommend?" | Jhyvie | Suggests a free time + Proposal card |
| 3 | "Papunta ako sa SM Megamall bukas ng 2PM." | Jhyvie | Travel planner with route time |
| 4 | "Plan my study for my bio quiz." | Rei | Ghost study blocks to confirm |
| 5 | "Remind me 30 minutes before my quiz." | Diel | Reminder set |
| 6 | "Start a 25-minute focus timer." | Diel | Timer starts |
| 7 | "Quiz me on chapter 3 of my bio reviewer." | Jaypee | Quiz from the library file |
| 8 | "Am I overloaded this week?" | Diel | Week load answer + suggestion |
| Backup | "When am I free tomorrow?" · "What's my closest deadline?" · "Can I fit a 1-hour gym session today?" · "Move my gym to 7pm." | any | Extra B-roll answers |

**Important:** the Pal answers are AI-generated, so they'll vary. Record several takes and pick the cleanest. Don't script the Pal's reply in post; use the real one.

---

## Demo data to set up BEFORE recording

Without this, the answers will be empty or boring. Set up the calendar for "tomorrow":
- 8:00–10:00 AM **Class** — Biology
- 9:00 AM **Deadline** — Org report
- 11:00 AM–12:00 PM **Commute**
- 1:00 PM **Quiz** — Bio Chapter 3
- 5:00–9:00 PM **Shift** — part-time work
- Leave a **free gap around 2–4 PM**, so the shopping recommendation has a good answer
- Tasks: "Bio quiz" (with estimated hours), "Thesis Ch.3", "History essay due Friday"
- Library: a **BIO** folder with a real reviewer PDF/DOCX (chapter 3); MATH and ENG folders with a file each
- A printed/photographed **class schedule** for D7
- Weather location set; nickname "JP"; energy peak set
- Use a **fresh profile** for the onboarding/Pal-picker tiles

Phone settings: Do Not Disturb ON (except Pal.do), battery 100%, clean status bar, same Pal per demo as in the table above.

---

## Shot list — what to RECORD

**Rule:** record every shot 3–5s longer than needed, hold 2s still at the start and end, and do at least 3 takes.

### A. Live action (JP)
| ID | Shot | Camera | Notes for VFX |
|---|---|---|---|
| L1 | Messy desk top-down | Overhead, static | + 5s **clean plate** without hands |
| L2 | Eyes close-up, stressed | Tight, 60fps | — |
| L3 | Laptop tabs + phone notifs | Over-the-shoulder | — |
| L4 | Wide, overwhelmed, clock visible | Static, wide | Desk lamp as the only harsh light |
| L5 | Falls asleep, head drops | Side profile, **60–120fps** | — |
| L6 | Phone beside sleeping head, screen off → on | Close, **tripod** | Most important plate. + 10s no movement |
| L7 | Sleeping JP from 3 angles (front-low, side, slow push) | Tripod / slider | Clean plate + a version with **markers** where each Pal lands (cup, papers, laptop edge, cheek) |
| L8 | Push into the phone | Slider/gimbal | Phone shows a **solid green image**; 4 tape dots on the phone corners |
| L9 | Jolts awake, paper on face | Medium, 60fps | 3 energy levels |
| L10 | JP picks up the phone, says lines 1–8 to it | Over-the-shoulder + front medium | Clean audio (lav mic). Look at the phone, then glance to the side as if a Pal is there |
| L11 | JP looks at floating things (for the motion graphics) | Medium, static | Look left/up/right on cue: these are the "UI flies out" reaction shots. Leave empty space around him |
| L12 | Typing focused | Medium + hands close | Space on the left for the floating 25:00 |
| L13 | Photographing the class schedule paper | Close on hands + phone | For D7 |
| L14 | Desk cleanup (shoot clean → messy, reverse in post) | Same angle as L1 | Same light as L1 |
| L15 | Stretch at sunrise | Wide, warm light | Space on his shoulder for the Pals |

### B. Screen recordings (with internal audio ON, so you get the Pal's real voice)
| ID | Record | For |
|---|---|---|
| S1 | Today screen, slow scroll (Now/Next, timeline, week strip, deadlines) | Act 2 dive-in, D1 |
| S2 | Reminder notification firing + alert sound | Alarm scene |
| S3–S10 | Lines 1–8 from the table, each from wake/tap to final answer | D1–D8 |
| S11 | Week grid with ghost blocks → confirm | D4 |
| S12 | Block Yard progress rings | D4 |
| S13 | Study method picker + timer start + Distraction bin | D5 |
| S14 | Library folders → Read (with voice) → Cards → Quiz | D6 |
| S15 | Class schedule import: attach → review rows → confirm | D7 |
| S16 | Onboarding: Pal carousel, nickname, energy peak | Speed-run |
| S17 | Desktop floating companion (picture-in-picture) — screen-record on the laptop | Speed-run |
| S18 | Dark mode toggle, best next step card, Settings (offline/on-device) | Speed-run |

Record on the **phone** (vertical, native resolution) and the **laptop** (for the desktop features). Also film the real phone with the camera for 2–3 demos so you can mix "real hand on phone" with clean screen footage.

### C. Audio
- JP: lines 1–8 (clean), sigh, yawn, startled gasp
- Pal lines for Act 2: generate them with **the same voice the app uses** for each Pal, so they match the demos
- 30s room tone

### D. Pal animations for compositing
Record each Pal in each needed state (`wave, idle, alert, happy, alarmed, cheer, talking, sleeping`) on a **plain green background** at large size, so they can be keyed out and placed in the room. *(I can build a small page in this repo that shows each Pal huge on green, for easy recording. Just ask.)*

---

## Shooting tips for clean effects
- **Manual everything:** exposure, focus, white balance locked.
- **Tripod** for L6, L7, L8, L14. If the camera moves, move it slowly.
- **One strong desk lamp** = consistent shadows, so the Pals' fake shadows match.
- **Lighting arc:** Act 1 cold/harsh → Act 2 dark, phone glow only → Act 3 warm sunrise.
- **4K** if possible, with JP centered, so you can crop to 9:16 for TikTok/Reels.

## Shoot-day order
1. Messy desk, harsh light → L1–L4
2. Dark + phone glow → L5–L8, then L9
3. Warm light → L10–L15
4. Screen recordings S1–S18 (any time; demo data set up first)
5. Audio

About **4–5 hours** total, including screen recordings.
