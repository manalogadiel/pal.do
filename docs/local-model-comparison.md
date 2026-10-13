# Local model comparison (PC and phone)

Measured on 2026-10-13 on a MacBook Pro M1 with 16 GB, using Ollama 0.40.3, with nothing else running. Each model went through the app's real local path: the same prompt, streaming, prompt reuse between messages, and the same reply checks. Run it again with:

```
node scripts/bakeoff.mjs <model> [<model> …]     # SHOW=1 prints every reply
```

- **First words / Full reply:** the median over 8 questions that go to the model (suggestions, lifestyle, small talk, a Taglish line, guardrails), warm.
- **Replay:** those 8 answered without breaking a guardrail.
- **Chat eval:** the 42 model cases in `src/lib/chat.eval.ts`. These call the model directly, without the app's own instant answers, card rules and safety nets, so the in-app experience is better than this number suggests.

| Model | Size | First words | Full reply | Slowest | Replay | Chat eval |
|---|---|---|---|---|---|---|
| **qwen3.5:9b** (PC default) | 7.6 GB | 0.9 s | 3.2 s | 12.1 s | 8/8 | **34/42** |
| llama3.1:8b | 4.9 GB | 0.6 s | 3.8 s | 9.1 s | 8/8 | 32/42 |
| **gemma4:e4b-it-qat** (PC fast fallback) | 6.1 GB | 0.4 s | 1.6 s | 5.4 s | 7/8 | 31/42 |
| qwen3.5:4b | 4.0 GB | 0.5 s | 1.7 s | 6.6 s | 8/8 | 29/42 |
| phi4-mini | 2.5 GB | 0.3 s | 2.9 s | 5.0 s | 8/8 | 29/42 |
| **Qwen2.5 1.5B Instruct** (phone, bundled; as `paldo-phone`) | 1.1 GB | 0.7 s | 1.5 s | 2.3 s | 8/8 | 29/42 |
| gemma4:e2b-it-qat | 4.3 GB | 0.3 s | 0.9 s | 2.7 s | 8/8 | 29/42 |
| qwen3.5:2b | 3.1 GB | 0.3 s | 1.7 s | 3.0 s | 8/8 | 25/42 |

Phone models were run on the Mac as stand-ins (same weights and prompt). On the phone itself they're several times slower.

## Choices
- **PC: `qwen3.5:9b`.** It's the smartest, and with streaming and prompt reuse it's fast enough: first words in under a second, about 3 s for a full reply.
  - Onboarding times one short reply on the machine and switches to **`gemma4:e4b-it-qat`** if the 9B takes over 6 s (`FASTER_LOCAL` / `LOCAL_SPEED_BUDGET_S` in `src/lib/groq.ts`).
  - Machines reporting under 8 GB of memory get `qwen3.5:4b`.
- **Phone: keep the bundled Qwen2.5 1.5B.** Gemma 4 E2B ties it on quality, but it's a 4.3 GB file, too big to ship in the APK. Qwen3.5 2B scored lower.
- **The cloud (Groq) is still first when online.** It's smarter than every local model here and answers in about 1–2 s. Local is the offline backup.

## Before this round
Earlier the same day, the 9B took 5–25 s per reply. The fixes were:
- **Prompt reuse:** the calendar facts moved after the chat history, so Ollama stopped re-reading about 2,000 tokens every message.
- **Streaming:** the first words show while the rest is written.
- **Shorter replies:** 180 tokens.
