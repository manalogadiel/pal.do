# Pal.Do — Complete Project & Architecture Documentation

> **Context AI / LLM Reference Document**  
> Comprehensive technical specification, architecture overview, feature breakdown, data models, guardrails, and system workflows for **Pal.Do**.

---

## 1. Executive Summary & Project Identity

- **Project Name:** Pal.Do (stylized as `pal.do`)
- **Tagline:** The AI Secretary and Academic Companion for Students
- **Core Motto:** *"Pal suggests and never decides."*
- **Event / Context:** EDTEK CON 2026 — AI Student Innovation Hackathon (*Mission: LearnPossible2 by HEXCOREPH*)
- **Official Challenge:** **Time Management / Academic Load**
- **Target Audience:** College students (especially non-IT and junior students) managing academic workloads, exam preparation, student organizations, part-time jobs, and long commutes.
- **Problem Statement:** Students rarely struggle from lack of effort; they struggle when their schedules collide (overlapping deadlines, exams, commutes, and commitments). Traditional calendars are passive buckets of events that don't prioritize or adjust when plans break. When a study block is missed, it turns into guilt, backlog, and late-night cramming.
- **Solution:** An agentic, empathetic planning secretary that ingests syllabi and schedules, breaks work into spaced study sessions, preserves pre-exam rest, assists during commutes, recovers missed blocks non-destructively, and operates under strict academic integrity guardrails.

---

## 2. Hackathon Compliance & Ethical Guardrails

As mandated by the official EDTEK CON 2026 guidelines, Pal.Do is engineered with hardcoded and prompt-level guardrails:

| Guardrail Principle | Implementation in Pal.Do | Enforcement Mechanism |
| :--- | :--- | :--- |
| **No Graded Work Completion** | Refuses to write essays, solve homework, write code assignments, or take quizzes for students. | Regex filter (`GRADED` in `src/lib/agent.ts`) + System Prompt rule: *"I can't write it for you, but I can save you focus time for it."* |
| **No Academic Dishonesty** | Does not provide test answers or cheat sheets; only creates study aids (spaced flashcards, practice quizzes) from user's own notes. | Extraction tools strictly synthesize questions from uploaded text without guaranteeing exam questions. |
| **No Medical / Burnout Diagnosis** | Will not diagnose clinical depression, burnout, or panic disorders. | Regex filter (`STRESS`) intercepts emotional queries and provides comforting words with a campus guidance office referral. |
| **No Grade Guarantees** | Refuses to predict GPAs, scores, or pass/fail outcomes. | Regex filter (`GRADES` / `BLOCKED_OUTPUT`) rejects prediction requests: *"I can't tell you your grade. I can show how much study time fits before the exam."* |
| **Non-Destructive Proposals** | AI never silently modifies or deletes user calendar entries. | All actions generate explicit **Proposal Cards** (`type: 'proposal' \| 'event' \| 'change'`) requiring tap or verbal user approval. |
| **Prompt Injection Defense** | Blocks system prompt leaks, persona hijacking, and jailbreaks. | Regex filter (`INJECT`): *"Let's stick to your schedule. Anything else coming up?"* |

---

## 3. Technology Stack & Toolchain

### 3.1. Frontend & Client Runtime
- **Framework:** React 19 (`^19.0.0`), React DOM 19
- **Build Tool:** Vite 8 (`^8.0.5`) with `@vitejs/plugin-react`
- **Language:** TypeScript 5.9 (`strict` mode enabled, comprehensive domain models)
- **Styling:** Vanilla Tailwind CSS v4 (`@tailwindcss/vite` and `tailwindcss ^4.0.0`)
- **Formatter & Linter:** oxfmt (`^0.2.0`)
- **Package Manager:** pnpm 10.33+ (configured via `.mise.toml` and `pnpm-workspace.yaml`)

### 3.2. Mobile & Native Integrations (Capacitor)
- **Runtime:** `@capacitor/core` (`^8.5.3`), `@capacitor/android` (`^8.5.3`), `@capacitor/cli` (`^8.5.3`)
- **Notifications & Alarms:** `@capacitor/local-notifications` (`^8.3.1`) — custom sound alerts (`paldo_alert.wav`), background channels
- **Native TTS:** `@capacitor-community/text-to-speech` (`^8.0.2`) — zero-latency system voices

### 3.3. AI, Multimodal & Speech Stack
- **Neural TTS (In-Browser):** `kokoro-js` (`^1.2.1`) — high-fidelity 82M ONNX model running in web workers (`src/lib/tts.worker.ts`)
- **Voice Activity Detection (VAD):** `@ricky0123/vad-web` (`0.0.31`) — real-time client-side speech boundaries
- **In-Browser Transformers:** `@huggingface/transformers` (`3.8.1`)
- **Document Processing:** `pdfjs-dist` (`6.3.289`) — parses text and renders PDF pages to HTML5 Canvas
- **Speech-to-Text (STT):** Whisper Large v3 Turbo via Groq / native browser SpeechRecognition API

---

## 4. Multi-Tier Hybrid AI Architecture

Pal.Do features a 4-tier fallback matrix ensuring zero downtime, low latency, and 100% offline functionality:

```
┌─────────────────────────────────────────────────────────────┐
│                    User Input (Text / Voice)                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                [Fast Regex / Command Parser]
                               │
            ┌──────────────────┴──────────────────┐
     (Device Command?)                     (Conversational?)
            │                                     │
    Instant Execution                      [Provider Gate]
  (Timers, Session, Next)                         │
                                   ┌──────────────┴──────────────┐
                              [Online]                       [Offline]
                                   │                             │
                   ┌───────────────┴───────────────┐     ┌───────┴───────┐
               [Tier 1]                        [Tier 2]  [Tier 3]    [Tier 4]
              Cloud Chain                     Local PC   Android    Offline
            Groq / Gemini                      Ollama    Native     Rules
      (Qwen 3.8 27B -> GPT-OSS)             (Qwen 3.5)   Model      (100%)
```

1. **Tier 1: Cloud Chain (Hosted Free Tiers)**
   - Sequential models: `qwen/qwen3.8-27b` → `openai/gpt-oss-120b` → `openai/gpt-oss-20b` → `gemini` (Gemini Flash-Lite).
   - If a model responds with HTTP 429 (Rate Limit / Quota Exceeded), the engine automatically records a cooldown period and tries the next model in the chain without interrupting the user.
   - Hosted proxy (`api/groq.ts` on Vercel) manages rate limits via Upstash Redis per device ID.
2. **Tier 2: Local PC AI (Ollama)**
   - Configurable host (`http://localhost:11434`, default `qwen3.5:4b`).
   - Automated pre-warming (`preloadOllama()`) keeps model weights resident in memory to avoid 40-second cold starts.
3. **Tier 3: Android On-Device AI**
   - MediaPipe / ONNX runtime integration on supported mobile devices for true native, private execution.
4. **Tier 4: Offline Deterministic Rules Engine**
   - Heuristic slot-filling dialogue manager in `src/lib/agent.ts`.
   - Comprehensive Taglish + English natural language parser for dates, times, durations, and intents.
   - 100% test passing rate across 125 conversational evaluation scenarios.

---

## 5. The Four Companion "Pals"

Pals are procedural 20×28 pixel-art animated companions rendered via canvas/grid matrices in `src/pals/Pal.tsx`. They possess distinct linguistic styles, tones, and visual animations:

| Pal ID | Name | Tone & Personality | Best For | Visual Palette |
| :--- | :--- | :--- | :--- | :--- |
| `rei` | **Rei** | Calm, gentle, encouraging, reassuring, never rushes you | Students feeling overwhelmed or stressed | Soft Lavender (`#c9c3e6`) |
| `diel` | **Diel** | Precise, organized, concise, structured, slightly nerdy | Students wanting clear, no-fluff plans | Mint Green (`#a6dcc6`) |
| `jhyvie`| **Jhyvie** | Playful, warm, chatty, speaks fluent natural **Taglish** | Students who want a friendly, relatable study buddy | Peach Coral (`#f8c9a8`) |
| `jaypee`| **Jaypee** | Hype friend, high-energy, brief, motivating | Students who need a push to get started | Sunny Gold (`#f7d046`) |

**Pal Animation States (`PalState`):**
- `idle`: Gentle breathing/swaying
- `listening`: Alert posture, ear/antenna movements
- `talking`: Mouth animations synced to TTS
- `sleeping`: Resting Z's (during quiet hours: 11 PM – 7 AM)
- `alert` / `alarmed` / `shocked` / `happy` / `wave` / `cheer`: Contextual micro-expressions

---

## 6. Detailed Feature & Functional Breakdown

### 6.1. Conversational AI & Slot-Filling Dialogue (`Chat.tsx`, `agent.ts`)
- **Intent Recognition:** Understands planning commands, schedule queries, weather queries, preferences, and cancellations.
- **Taglish Support:** Native handling of Filipino slang and particles (*"mamaya 3pm"*, *"bukas pagkatapos ng klase"*, *"di ako pwede sa sunday"*, *"i-lock mo na"*).
- **Slot Filling:** Prompts for missing parameters step-by-step (e.g., if user says *"I have a quiz on Friday"*, Pal asks *"How many hours of review feels right?"*).
- **Proposal Cards:** Renders rich visual cards in the chat stream:
  - `readback`: Confirm task title, kind, deadline, and hours.
  - `proposal`: Proposed study blocks with exact times and rationale.
  - `event`: Proposed individual event with conflict detection and nearest free time.
  - `change`: Non-destructive move or delete confirmation.
  - `file`: Attached study material card with action chips.

### 6.2. Calendar & Smart Scheduling Engine (`Calendar.tsx`, `schedule.ts`)
- **Event Types (`Kind`):** `class`, `shift`, `exam`, `work` (study), `commute`, `protected`, `deadline`.
- **Anti-Cram Exam Rule:** Caps maximum study time per day (default 2–3h) and reserves the night before an exam for rest and light review.
- **Clash Detection & Alternative Suggestion:** When a new event collides with existing events, Pal calculates the nearest available free window (`nearestFree()`) and presents it on the card.
- **Commute-Aware Integration:** Identifies commute blocks and prompts users to utilize that time for audio review or flashcards.
- **Missed-Block Recovery:** Check-in engine queries missed events (*"Did you finish this?"*); if answered partially or not done, moves remaining hours into future buffer slots.
- **Energy Preference:** Places high-focus review blocks in morning, afternoon, or evening based on user setting.

### 6.3. Focus & Pomodoro Engine (`Study.tsx`, `session.ts`)
- **Standard Protocol:** 25-minute focus blocks, 5-minute short breaks, 15-minute long breaks after 4 rounds (`LONG_EVERY = 4`).
- **State Machine:** `idle` → `focus` → `shortBreak` → `longBreak`, supporting pause, resume, and skip.
- **Background Persistence:** Sessions are timestamp-based (`phaseEnds`, `startedAt`), ensuring timer accuracy even if the app or tab is closed.
- **Audio Chimes & Notifications:** Plays alert chimes on completion and triggers native OS notifications.

### 6.4. Study Library & Document Intelligence (`Library.tsx`, `study-material.ts`)
- **Subject Folders:** Color-coded folder storage with custom stickers and deadline indicators.
- **Multi-Format Support:** Ingests PDF documents, images, and text notes (`importFile()` in `src/lib/study-files.ts`).
- **Canvas PDF Viewer:** High-performance PDF page rendering via `pdfjs-dist` on HTML5 canvas.
- **Read Aloud (Commute Mode):** Segment-by-segment text-to-speech highlighting with `kokoro-js` or Native TTS.
- **Automated Flashcards:** Heuristic and LLM-powered extraction of concepts, definitions, and formulas into interactive 3D flip cards.
- **Practice Quizzes:** Generates 4-choice multiple choice quizzes with instant correctness checking and explanatory rationales.
- **Plan Study from File:** Analyzes document word counts and page volume to calculate estimated study hours (`studyHours()`) and triggers automatic study session scheduling.

### 6.5. Fast Device Commands & Voice Control (`commands.ts`, `handsfree.ts`)
- **Bypasses LLM Latency:** Regex parser intercepts commands for instantaneous local execution:
  - Timers: *"Set a timer for 10 minutes and warn me last 30 seconds"*
  - Reminders: *"Remind me at 4pm to print the reviewer"*
  - Pomodoro: *"Start focus"*, *"Pause session"*, *"Skip break"*
  - Queries: *"What's next?"*, *"How much time left?"*, *"What's my name?"*
- **Hands-Free Loop:** Continuous listening with VAD, audio chime confirmations, and follow-up expectation states.

---

## 7. Data Models & Schemas

### Core Schedule Types (`src/lib/core.ts`)
```typescript
export type Kind = 'class' | 'shift' | 'exam' | 'work' | 'commute' | 'protected' | 'deadline'
export type Status = 'planned' | 'proposed' | 'done' | 'missed'
export type TaskKind = 'exam' | 'assignment'
export type PalId = 'rei' | 'diel' | 'jhyvie' | 'jaypee'
export type PalState = 'idle' | 'listening' | 'talking' | 'sleeping' | 'alert' | 'alarmed' | 'shocked' | 'happy' | 'wave' | 'cheer'

export interface CalEvent {
  id: string
  title: string
  kind: Kind
  start: number   // Epoch timestamp (ms)
  end: number     // Epoch timestamp (ms)
  status: Status
  taskId?: string
  seg?: string    // e.g. "1/3" for spaced study sessions
  why?: string    // Explanation for proposal
  note?: string
}

export interface Task {
  id: string
  title: string
  kind: TaskKind
  due: number     // Epoch timestamp (ms)
  hours: number   // Total estimated review hours
  doneHours: number
}
```

### Study Library Types (`src/lib/library.ts`)
```typescript
export interface Folder {
  id: string
  name: string
  created: number
  style: { tone: 'sage' | 'peach' | 'sky' | 'butter' | 'lavender'; tab: 0 | 1 | 2; pattern: 0 | 1 | 2 }
}

export interface LibraryFile {
  id: string
  folderId: string
  name: string
  pages: string[]
  blob: Blob
  kind: 'pdf' | 'text' | 'image'
  scanned?: boolean
  created: number
}

export interface CardItem {
  id: string
  prompt: string
  answer: string
  topic?: string
}

export interface QuizQuestion {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  why: string
}
```

### Focus Session Types (`src/lib/session.ts`)
```typescript
export type Phase = 'idle' | 'focus' | 'shortBreak' | 'longBreak'

export interface Session {
  phase: Phase
  round: number          // 1 to 4
  startedAt: number
  pausedAt?: number
  accumulatedPauseMs: number
}
```

---

## 8. Directory & File Structure

```
pal.do/
├── api/                           # Vercel Serverless Functions
│   ├── _lib/
│   │   └── proxy.ts               # Proxy implementation, rate limiter & Redis quotas
│   └── groq.ts                    # POST /api/groq entrypoint
├── android/                       # Capacitor Android native project
├── public/                        # Static assets, sounds, icons
├── scripts/                       # Build & eval test scripts
│   ├── eval-chat.mjs              # Main test runner (rules, session, voice, library)
│   ├── check-android-ai.mjs       # Android AI reliability test suite
│   ├── prepare-android-ai.ps1     # Powershell asset prep for Android
│   └── build-android-preview.ps1  # Automated APK build script
├── src/
│   ├── components/                # React UI Components
│   │   ├── Calendar.tsx           # Weekly grid calendar & LoadStrip
│   │   ├── Chat.tsx               # Chat message feed, cards, mascot bubble
│   │   ├── Icons.tsx              # Vector SVG icon collection
│   │   ├── Library.tsx            # Subject folders, PDF reader, cards, quiz
│   │   ├── Nav.tsx                # Desktop Rail & Mobile TabBar
│   │   ├── Overlays.tsx           # Modals, Settings, Syllabus importer, Toasts
│   │   ├── StatusBadge.tsx        # Network & active AI model pill
│   │   ├── Study.tsx              # Focus (Pomodoro) + StudyTabs
│   │   ├── Tasks.tsx              # Task lists & progress bars
│   │   ├── TimerPill.tsx          # Active timer badge
│   │   └── Today.tsx              # Daily overview & timeline
│   ├── lib/                       # Core logic & algorithms
│   │   ├── agent.ts               # Dialogue engine, proposals, guardrails
│   │   ├── ai-mode.ts             # AI runtime mode toggle (online/offline/local)
│   │   ├── commands.ts            # Fast regex device command parser
│   │   ├── context.ts             # LLM prompt context assembler
│   │   ├── conversation.ts        # Chat context focus tracking
│   │   ├── core.ts                # Data types, date helpers, seed week
│   │   ├── groq.ts                # LLM client, model fallback chain, Ollama
│   │   ├── handsfree.ts           # Hands-free voice state machine
│   │   ├── library.ts             # IndexedDB / storage for files & quizzes
│   │   ├── native-ai.ts           # Android native AI bindings
│   │   ├── native-tts.ts          # Capacitor TTS wrapper
│   │   ├── notifications.ts       # Web & Capacitor local notifications
│   │   ├── parse.ts               # Taglish/English date & time extraction
│   │   ├── schedule.ts            # Conflict resolution & slot allocation
│   │   ├── session.ts             # Pomodoro state machine
│   │   ├── study-files.ts         # PDF/Image parsing via pdfjs-dist
│   │   ├── study-material.ts      # Flashcard & quiz heuristics
│   │   ├── timers.ts              # Countdown timer & reminder management
│   │   └── wake.ts                # Wake word detection
│   ├── pals/
│   │   └── Pal.tsx                # Procedural 20x28 pixel art renderer
│   ├── App.tsx                    # Root component, state coordination
│   ├── index.css                  # Global Tailwind CSS v4 & theme tokens
│   └── main.tsx                   # React root entrypoint
├── capacitor.config.ts            # Capacitor native configuration
├── package.json                   # Dependencies and npm scripts
├── pnpm-workspace.yaml            # pnpm native package build overrides
├── vite.config.ts                 # Vite 8 config with Tailwind v4 & workers
└── vercel.json                    # Vercel deployment routes and headers
```

---

## 9. Verification & Testing Framework

Pal.Do includes a comprehensive local test suite that can be run without internet access:

1. **`pnpm eval:chat` (`scripts/eval-chat.mjs`)**
   - **Rules Engine:** 125 test cases verifying conversational handling, Taglish parsing, calendar changes, guardrails, and injection defense.
   - **Session Tests:** Verifies Pomodoro timing, transitions, round resets, and pauses.
   - **Voice & Commands Tests:** Verifies spoken durations, timer creation, reminders, and wake words.
   - **Study Library Tests:** Verifies text extraction, card generation, and quiz construction.
   - **Chat Reliability Tests:** Verifies sanitization of model outputs against hallucinated writes.
2. **`pnpm check:android-ai` (`scripts/check-android-ai.mjs`)**
   - 18 test cases evaluating Android on-device model compatibility and fallback behavior.
3. **`pnpm build`**
   - Production Vite bundle compilation, verifying strict TypeScript types and asset pipelines.

---

## 10. How to Run, Configure & Deploy

### Development Server
```bash
# Install dependencies
pnpm install

# Start Vite dev server
pnpm dev
# App will run at http://localhost:5173 or http://localhost:8443
```

### AI Configuration
- **Offline / Default:** Works immediately out of the box using built-in deterministic rules.
- **Cloud AI (Groq):** Provide a free Groq API key:
  - Inside App: **Settings (Gear icon) → Groq API Key**
  - Via `.env`: Create `.env` with `VITE_GROQ_API_KEY=gsk_...`
- **Local PC AI (Ollama):** Run `ollama run qwen3.5:4b`, then set URL in Settings (`http://localhost:11434`).

### Production Deployment (Vercel)
The repository includes `vercel.json` and `api/groq.ts`. Simply push to GitHub and deploy to Vercel. Add `GROQ_API_KEY` (and optionally `GEMINI_API_KEY`) as private environment variables in the Vercel dashboard.
