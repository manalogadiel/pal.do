# Plan: Chronos Minimalist UI/UX & "Time of Day" Palette Redesign

## 1. Design Read & Principles
- **Design Read:** Student productivity companion redesign for college students, adopting a modern, calm, and minimalist aesthetic inspired by Linear and contemporary Swiss UI principles.
- **Color Identity:** "Time of Day" palette (replacing the warm Claude/Anthropic parchment defaults):
  - `#e8dbe2`: Lilac Alabaster (clean, serene canvas background)
  - `#54597d`: Dusk Indigo (primary ink, structural headers, high contrast)
  - `#5e658a`: Slate Heather (secondary ink, card borders, subtle rules)
  - `#b4c4ec`: Dawn Periwinkle (active selection, focus timers, calm highlights)
  - `#a285a8`: Twilight Mauve (brand accent, replacing previous terracotta orange)
- **Typography:** Strip out `Instrument Serif` (editorial AI-tell). Unify under modern, crisp `Inter Tight` with tight letter tracking (`tracking-tight`) and balanced hierarchy.
- **Dials:**
  - `DESIGN_VARIANCE: 5` (Disciplined, balanced structure)
  - `MOTION_INTENSITY: 4` (Smooth, purposeful micro-transitions)
  - `VISUAL_DENSITY: 3` (Airy, generous breathing space, low cognitive load)

---

## 2. Redundancy & Cognitive Load Audit (Targeted Reductions)

### 2.1. Chat & Dialogue
- **Problem:** When chat opens, user sees the Mascot Bubble (*"Hey! What's your week looking like?"*), plus the H2 (*"Tell {pal} what your week looks like"*), plus an explainer paragraph (*"Classes, shifts, deadlines. Type it or say it..."*), plus 4 chips.
- **Solution:** Cut the wall of text. Use a single punchy headline: *"What's on your plate today?"* and 3 clean action chips. Let the interface get out of the way.

### 2.2. Today View (Home)
- **Problem:** Triple-stacked date & time headers (`Wednesday` + `October 14` + `4 things left today` + separate section titled `Today` + `Now/Next` cards duplicating timeline items).
- **Solution:** Combine into one unified, linear timeline:
  - Clean hero: Date & Pal with a single line status.
  - Clear "Current / Up Next" highlight without repeating entries in an extra agenda block.
  - Clean progress ring and deadline cards.

### 2.3. Mascot Display on Desktop
- **Problem:** Three simultaneous Pals on desktop (Stage Pal, Chat Pal, Top Bar Pal chip).
- **Solution:** Only render Pal in **one** contextual place per view. Hide redundant top-bar avatar when the main Pal is already front and center.

### 2.4. Study Library
- **Problem:** Repetitive instructional paragraphs inside folder cards and empty states.
- **Solution:** Replace wordy explanations with a clean, functional prompt: *"Drop notes, reviewers, or syllabi here."*

### 2.5. Event Rainbow Colors
- **Problem:** 7 candy-colored pastel backgrounds for event kinds that fight for attention.
- **Solution:** Anchor events into the Time of Day palette with subtle left-border indicator rules and soft tinted glass containers.

---

## 3. Implementation Steps

### Phase 1: Design Tokens & Typography (`src/index.css`)
1. Update `:root` variables:
   - `--paper`: `#f7f4f6` (soft mist)
   - `--paper-2`: `#eee8ec` (card surface)
   - `--paper-3`: `#e4dce2` (hover surface)
   - `--ink`: `#1f2233` (deep midnight slate)
   - `--ink-2`: `#54597d` (dusk indigo secondary)
   - `--ink-3`: `#8388a4` (muted slate)
   - `--accent`: `#a285a8` (twilight mauve)
   - `--accent-soft`: `#f0e8f2` (soft mauve tint)
   - `--periwinkle`: `#b4c4ec` (dawn highlight)
2. Update `:root.dark` variables to deep indigo-slate nocturne (`#10111a`, `#171926`, `#212338`).
3. Replace `--font-serif` references with `--font-sans` (`Inter Tight`) with modern tracking.
4. Harmonize event category color tokens into the time-of-day spectrum.

### Phase 2: Brand Identity Update (`pal.do` → `Chronos`)
1. Update `index.html` title: `Chronos — Student Time Companion`.
2. Update `src/components/Icons.tsx`: Update `Wordmark` component to render `Chronos` with sleek letter-spacing.
3. Update `capacitor.config.ts`: `appName: 'Chronos'`.

### Phase 3: Component Cleanup & Hierarchy Polish
1. **`src/components/Today.tsx`**:
   - Streamline header hierarchy: replace triple date labels with clean, modern layout.
   - Unify timeline and Now/Next cards into a seamless, scannable agenda.
   - Clean up spacing and button styles.
2. **`src/components/Chat.tsx`**:
   - Strip out redundant instructional onboarding paragraph.
   - Simplify mascot bubble to prevent echoing text already in the feed.
   - Tighten card presentation and action chips.
3. **`src/components/Nav.tsx` & Desktop Rail**:
   - Apply clean minimalist border and hover states aligned with Time of Day palette.
   - Clean up badge indicators.
4. **`src/components/Library.tsx`**:
   - Simplify folder stickers and remove redundant guidance paragraphs.
   - Tighten file row actions (`Plan`, `Cards`, `Quiz`, `Read`).
5. **`src/components/Study.tsx`**:
   - Minimalist Pomodoro display: high-contrast timer digits, clean progress dots, unobtrusive alarms toggle.

### Phase 4: Validation & Quality Control
1. Run `pnpm build` to verify zero TypeScript or Vite bundle errors.
2. Run `pnpm eval:chat` to verify all 125 rules, session, voice, and reliability tests pass 100%.
3. Run `pnpm check:android-ai` to ensure Android AI tests pass.
4. Visually inspect hot-reloaded UI to confirm clean aesthetic execution.
