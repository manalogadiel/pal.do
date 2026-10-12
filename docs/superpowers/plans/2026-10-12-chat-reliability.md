# Chat reliability plan and implementation results

## Scope

Improve the shared scheduling conversation before changing models. Both Groq online models and configurable Ollama models use the same request state, calendar facts, action validation, and confirmation rules. No new model, dependency, or Android inference runtime is installed.

## Implemented

- [x] Separate automatic, forced cloud, and forced local routing. Local evaluation cannot silently use cloud credentials or the proxy. Cloud evaluation cannot fall back to Ollama.
- [x] Expose proposed and accepted calendar blocks with status, task association, complete ranges, and exact task deadline times. Prioritize the current subject when limiting the calendar snapshot.
- [x] Persist the current request separately from chat prose. Handle greetings, new requests, rejected interpretations, replacement events, subject changes, explicit dates, exam start/end, review duration, daily review, and earliest study dates.
- [x] Validate model actions against the latest request in both providers. Reject malformed JSON, wrong field types, rejected interpretations, and mismatched event details.
- [x] Give local models a compact prompt and structured response schema. Query thinking capability before sending thinking controls; retry legacy JSON once only when a server rejects schema format.
- [x] Render review times from actual scheduling results. Preserve the real exam time and finish review before its start. Ask about conflicting exam-date corrections before changing calendar facts.
- [x] Resolve previous review groups using real proposal membership. Show every target in the confirmation card, remove exact previewed IDs, preserve the actual exam, and reject stale confirmations. Retain Undo.
- [x] Integrate 28 regression checks into the existing evaluation command. Model evaluation failures now cause a failing exit status.

## Verification performed

- Existing rules: 125/125 passed, plus session and voice checks.
- New reliability checks: 28 passed. They cover the supplied correction sequence, subject/duration separation, daily review, date constraints, exact group selection/removal, crowded-calendar references, provider isolation, malformed replies, and legacy schema fallback.
- TypeScript check and production build passed. The build retains its existing ONNX runtime asset warning.
- Browser checks: a new request clears old exam details; Seminar later asks for a time; 3–5pm previews today; rejection adds nothing. App Dev exam tomorrow 4–6pm remains at that time. A two-hour review request produces real blocks before the exam. Removing the exact two review blocks preserves the actual exam.
- Installed models found: qwen2.5:0.5b, qwen3.5:2b, qwen3.5:4b. No downloads performed.
- Small direct-model smoke sample: qwen2.5:0.5b passed 1/3; qwen3.5:2b passed 2/3. These are model-only wording/action probes, separate from deterministic application handling. They show why app-owned state and fallback remain necessary.
- Forced cloud smoke sample: 4/4 passed, including the recovery check. This is a small sample, not a benchmark of every configured cloud model.

## Remaining device and model validation

- Full repeated live transcript runs across every model tag were not performed. The current automated transcript coverage exercises production parsing, context, validation, and group-removal helpers; the browser check exercises the application orchestration.
- Android was unavailable during the initial shared-chat work. The subsequent connected-phone prototype and its measured results are documented in [Android preview](../../android-preview.md); phone-local inference now uses the native bridge rather than desktop Ollama.
- The shared safeguards apply to every configured model; conversational quality still depends on model capability. A 0.5B model is not expected to match a larger model's language understanding.

## References

- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Ollama chat API](https://docs.ollama.com/api/chat)
