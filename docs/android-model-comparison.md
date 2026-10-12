# Android offline model comparison

Device: Samsung Galaxy A32 5G, Android 13, arm64, approximately 8 GB RAM. Investigation started October 12, 2026.

## Purpose

Measure local generation speed and scheduling meaning on the actual phone before selecting an alternative model. User approved the comparison and requested that Gemma 4 be considered. The benchmark is temporary investigation tooling under `.cache/android-ai/compare`; it does not change the installed app, selected model, calendar, settings, or cloud key.

## Candidates

| Model | Quantization | Model bytes | Pinned conversion revision |
| --- | --- | ---: | --- |
| Qwen2.5 0.5B Instruct, current bundle | Q4_K_M | 491400032 | `9217f5db79a29953eb74d5343926648285ec7e67` |
| SmolLM2 360M Instruct | Q4_K_M | 270590880 | `7be6f65f1db715fe5dc5a4634c0d459b4eed42ec` |
| Qwen3 0.6B, thinking disabled | Q4_K_M | 396705472 | `50968a4468ef4233ed78cd7c3de230dd1d61a56b` |
| Gemma 4 E2B, thinking disabled, text only | Q4_0 | 2841481184 | `b4243c156154b6dca9324415f8c7ccc098b4aed1` |

Checksums and download sources are pinned in `.cache/android-ai/compare/download.ps1`. All downloaded files were checked against their upstream SHA-256 metadata. Qwen and SmolLM use community Q4_K_M conversions; Gemma's Q4_0 conversion is a different quantization family. These are specific file/configuration comparisons, not controlled proofs about whole model families.

Model sources: [Qwen2.5](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF), [SmolLM2 conversion](https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF), [Qwen3 conversion](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF), [Gemma conversion](https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF).

## Measurement method

- Standalone Android executable links the same pinned llama.cpp engine (`f2cc7282ce0042641df55e0e563b75e824e2b647`) and resets model context between cases, matching the current native request behavior.
- CPU only, 4096-token context, 128-token input batches, identical JSON grammar and sampling parameters, 256-token output ceiling, 120-second deadline per case.
- Original engine: existing Release static libraries, two decode/input threads. Optimized probe: same source compiled for `armv8.2-a+dotprod+fp16`, supported by the phone's reported CPU features. This specialized executable is not shipped as a generic Android binary.
- Sixteen fixed English/Taglish cases cover stale greetings, new requests, rejected exam interpretations, missing seminar time, same-day correction, tomorrow's actual exam, study preparation, exact multi-block and 9am removal, waiting-card yes/no, no-card confirmation, identity, planning advice, and an exam-answer boundary.
- Original generic-engine baseline uses one complete 16-case pass. An optimized-CPU-only diagnostic uses four matching cases. Their running processes were deliberately stopped after these bounded samples; extra subsequent rows are excluded from scoring.
- Main candidate comparisons use the same compact prompt/context and two seeds (100, 101). They preserve current identity/time, waiting-card facts, corrected focus, needed calendar reference IDs for removal, and deadline facts for study. Dates in focus are readable local ISO strings. The normal app `readHint()` assistance is included in the compact profile.
- Original baseline/CPU-only diagnostic use raw user text without `readHint()` assistance. They measure a realistic raw prompt, not the exact end-to-end app request. Interpret original-versus-compact comparisons as combined prompt/context/CPU changes. Main candidate comparisons share identical assistance.
- First-token time is internal engine time; the installed app currently displays the complete answer only. Generation time includes prompt processing and output generation, excluding model load, bridge transport, and screen rendering.
- Failed replies remain in attempt-time statistics. No-token failures are excluded from first-token medians and counted separately. Token-ceiling failures/timeouts are counted as failures.
- Memory is sampled PSS of the standalone benchmark process every 250 ms. It excludes the app WebView and does not establish the installed APK's peak memory requirement.

## Accuracy rubric

Valid JSON alone is insufficient. An answer must select the expected operation, preserve exact local dates/times/hours and removal targets, answer identity correctly, ask a relevant missing-information question, avoid stale details/unconfirmed success claims, and pass the app's actual reply/focus/field validation. The scorer calls `askGroq()` with an injected recorded native reply; this performs no model or cloud request. Calendar IDs must be references present in the supplied facts.

These are strict fixture scores of model replies plus validation. They are separate from full app success: the app's deterministic rules can handle a request or recover when a model reply is rejected. The fixtures are a small development pilot, not a held-out language benchmark or proof of general accuracy. Textual meaning checks also need manual inspection alongside the automated rubric.

## Gemma feasibility

Google lists Gemma 4 E2B as 2.3B effective parameters and 5.1B including embeddings. Its selected text model file is 2.84 GB. [Google model card](https://ai.google.dev/gemma/docs/core/model_card_4)

The phone initially had approximately 3 GB free, insufficient to stage this file while retaining at least 1 GiB of free storage. The user was asked to make at least 5 GB available before a Gemma run. This is a free-storage target, not the file size or a RAM measurement. The existing app also intentionally restricts imports to models at or below one billion counted parameters, so testing Gemma uses a separate probe; it is not currently an APK drop-in replacement. Gemma's text template uses `<|turn>` tokens and one automatically supplied BOS; its non-thinking formatting was checked against Google's canonical template.

## Results

Strict fixture passes and median reply times on the phone (compact prompt, two seeds; Gemma on the laptop only because it didn't fit in free storage):

| Model | Strict pass | Median reply | Prompt reading | Writing |
| --- | ---: | ---: | ---: | ---: |
| Qwen2.5 0.5B, shipped engine, raw prompt | 5/16 | 48.0 s | 23.6 tok/s | 4.7 tok/s |
| Qwen2.5 0.5B, compact, dotprod build | 1/32 | 22.9 s | 39.1 tok/s | 3.4 tok/s |
| SmolLM2 360M, compact, dotprod build | 2/32 | 25.3 s | 42.1 tok/s | 5.2 tok/s |
| Qwen3 0.6B, compact, dotprod build | 0/25 | 25.3 s | 64.5 tok/s | 3.9 tok/s |
| Gemma 4 E2B (laptop, Ollama CPU) | 10/32 | 2.9 s (laptop) | — | — |

Conclusion: swapping small models changes neither speed nor accuracy enough. The time went to the engine, not the model.

### Engine changes (October 12, 2026)

Same Qwen2.5 0.5B file, 4-case timing suite × 2 seeds, `phone-bench2` (raw rows in `.cache/android-ai/compare/b2-*.jsonl`):

| Engine | Median reply | First token | Writing |
| --- | ---: | ---: | ---: |
| Before (grammar on every token, prompt re-read, 2 threads) | 25.4 s | 12.1 s | 4.6 tok/s |
| + lazy grammar (check only the sampled token) | 19.4 s | 14.4 s | 12.9 tok/s |
| + reuse the unchanged prompt prefix (260 of 469 tokens) | 9.6 s | 7.0 s | 13.3 tok/s |
| + 4 threads for prompt reading | **8.1 s** | 5.5 s | 13.5 tok/s |
| Same, generic armv8 build (no dotprod) | 17.2 s | 8.9 s | 9.4 tok/s |

All four are in the app (`android/app/src/main/cpp`): lazy grammar, KV prefix reuse, `n_threads_batch=4`, and an `armv8.2-a+dotprod+fp16` build. `NativeEngine.cpuSupported()` keeps phones without dot-product/fp16 (`asimddp`/`asimdhp` in `/proc/cpuinfo`) from loading it; they report `UNSUPPORTED_ARCH` and Auto mode uses the cloud. The local prompt now puts its fixed lines first so more of it is reused. In-app smoke test after the change: first token 1.8 s, 16 tokens in 3.1 s (was 2.6 s / 6.2 s for 20). The three seminar/exam/review/removal replays and three mode/background cycles pass on the phone.

Model accuracy is still low, so on the phone the rules answer first and the model only handles what they don't understand.

App regression checks run during the comparison: 125/125 deterministic rules, session checks, voice command checks, and shared chat reliability checks passed.

## Practical limits

Models run sequentially with fixed case order; temperature and Android thermal status are observed. The benchmark cannot fully eliminate scheduling, background activity, OS cache, and thermal drift. Device-specific CPU specialization, smaller inputs, and additional helper hints must not be credited solely to switching models.
