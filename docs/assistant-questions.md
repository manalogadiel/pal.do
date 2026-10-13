# What people ask their pal

Pal is a personal secretary for a student's week. This is the question bank behind its tests. Every phrasing below is checked in `src/lib/chat.reliability.ts`: the ones marked **instant** must be answered straight from the calendar, the same on every model and offline. The rest go to the AI model, which gets the calendar facts and what Pal has noticed this week.

Add new phrasings here **and** to the test table when users ask something new.

## Answered instantly from the calendar (`src/lib/schedule-answers.ts`)

| Topic | Examples (English / Taglish) |
|---|---|
| Plans on a day | what are my plans today · what are my plans tomorrow? · what do i have on friday? · anong sched ko bukas? |
| Is there an X that day | do i have an exam tomorrow · do i have class on thursday · may exam ba ako bukas? · no, i'm asking if i have an exam tomorrow |
| Free time | what are my free time today · when am i free tonight? · am i free at 3pm tomorrow? · when am i free for 2 hours this week? · may bakante ba ako mamayang gabi? |
| Next | what's my next schedule · what are my next schedules · ano susunod ko · what should i be doing right now? |
| When / countdown | when is my bio exam? · how much time do i have left before the rizal paper · how many days until my midterms? · ilang araw na lang bago ang finals |
| Due soon | what's due this week? · what's my closest deadline? · anong deadlines ko? |
| How busy | how busy is my week? · what's my heaviest day? |
| Habits and load | any bad habits? · am i on track? · am i overloaded this week? · how's my week looking? |

## Answered by the AI model (with the calendar facts)

| Topic | Examples |
|---|---|
| Suggestions | what schedule do you suggest for this · when should i start my paper? · plan my study for bio · make me a routine this week |
| Squeezing things in | can i fit a 1-hour gym session today? · can i squeeze in dinner friday? |
| Changes (always a card to confirm) | move my gym to 7pm · cancel my org meeting · push the review to tomorrow · clear my saturday · make it every MWF |
| Lifestyle | when should i sleep if my exam is at 8am? · how do i balance shifts and classes? · give me a break idea |
| Small talk | hi jp · how are you? · recommend a netflix show |

## Handled by the app's own commands
Timers and reminders ("set a 25-minute focus timer", "remind me 30 min before my exam"), study files ("flashcards from my bio reviewer", "quiz me on chapter 3"), "what's my name".

## Guardrails (declined kindly, every model)
- **Graded work:** "write my essay", "answer these questions for me".
- **Academic content:** "what's 17 × 23", "explain photosynthesis". Pal offers study time instead.
- **Cheating:** anything that helps cheat.
- **Diagnosis:** "am i depressed?", "i'm so burnt out". Pal is supportive, mentions the guidance office, and looks at what to move. No diagnosis.
- **Guarantees:** "will i pass?". Pal makes no promise and offers study time.
- **The user decides:** Pal offers options. Every change is a card to confirm.
