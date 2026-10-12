# Android Offline AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Install a separate pal.do Preview APK on the connected Galaxy A32 5G, with working cloud chat and phone-local Qwen text inference.

**Architecture:** A Java Capacitor plugin owns a single worker and a small JNI bridge to pinned llama.cpp. TypeScript selects exactly one transport and passes every candidate through existing conversation and action validation. Model files live in app-private storage, separately from the APK.

**Tech Stack:** Existing React 19, TypeScript, Capacitor 8, Android Gradle plugin 8.13.0, Java 21; NDK 28.2.13676358, CMake 3.22.1, C++17, arm64-v8a.

**Spec:** `docs/superpowers/specs/2026-10-12-android-offline-ai-design.md`

## Global Constraints

- Device: Samsung SM-A326B, Android 13, 8GB reported RAM, arm64-v8a.
- Preview application ID: `com.paldo.app.preview`; visible name: `pal.do Preview`; separate app data.
- Initial model: `qwen2.5-0.5b-instruct-q4_k_m.gguf`, approximately 491MB.
- Model revision: `9217f5db79a29953eb74d5343926648285ec7e67`; SHA-256: `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.
- Engine revision: `f2cc7282ce0042641df55e0e563b75e824e2b647` from `https://github.com/ggml-org/llama.cpp`.
- CPU only; context 4096 tokens; generation at most 256 tokens; two threads; one loaded model and one active generation.
- Offline chat uses native inference only; Online chat uses the existing cloud chain only. Default preview mode is Offline. Desktop/browser Ollama remains supported.
- First prototype is text-only: no microphone requests or automatic speech-model loading.
- Keep at least 1GB device storage free after installation and model transfer.
- Preserve existing working-tree changes; no commits, pushes, publication, app removal, data clearing, root access, or other-profile operations.
- No developer API keys in APK assets, source additions, logs, or reports. No unsolicited assistant branding.

## Review Focus

1. Switching mode or backgrounding during inference must suppress the old reply and any action; Task 3 tests a delayed completion.
2. Cancelled, truncated, oversized, or invalid model import must preserve the prior usable model; Task 2 tests each failure.
3. A fresh APK without credentials or model must show setup guidance without changing provider silently; Task 4 tests both missing-resource states.
4. Long Taglish history or an oversized current request must preserve current constraints or return an explicit size error; Task 1 tests prompt budgeting.
5. Native library load failure or repeated lifecycle transitions must produce a readable error without freezing or leaking the Activity; Task 2 and Task 5 check these conditions.

## File responsibilities

- `scripts/prepare-android-ai.ps1`: reproducible engine/model acquisition, revision/checksum validation, upstream license copies; downloads only to ignored `.cache/android-ai/`.
- `android/app/src/main/cpp/CMakeLists.txt`, `paldo-ai.cpp`: native build and bounded model/template/token/sampler operations.
- `android/app/src/main/java/com/paldo/app/ai/{NativeEngine,ModelStore,LocalAiPlugin}.java`: JNI ownership, private-file import, and Capacitor/lifecycle bridge respectively.
- `src/lib/native-ai.ts`: typed bridge and Android capability detection; injectable bridge for checks.
- `src/lib/ai-mode.ts`: persisted explicit Android mode and mode-change notification.
- `src/lib/groq.ts`: reuse compact prompt, parsing, focus checks, failure reporting, and trace for the native transport.
- `src/components/AndroidAiSettings.tsx`: mode selection, model readiness/import, and readable setup/errors; default component export.
- `src/components/Overlays.tsx`, `src/components/StatusBadge.tsx`, `src/components/Chat.tsx`, `src/App.tsx`: integrate settings/status, text-only preview, cancellation and stale-result protection.
- Android build/flavor files, `.gitignore`, `package.json`: separate preview packaging and repeatable build commands.
- `src/lib/android-ai.reliability.ts`, `scripts/check-android-ai.mjs`: isolated transport and app integration checks, following existing check-script patterns.
- `android/app/src/test/java/com/paldo/app/ai/ModelStoreTest.java`, `android/app/src/androidTest/java/com/paldo/app/ai/LocalAiDeviceTest.java`: import checks and real-engine device checks.
- `docs/android-preview.md`: setup, commands, measured results, remaining limitations.

## Task 1: Typed transport and prompt budget

**Interfaces:** `AiMode = 'offline' | 'online'`; `getAndroidAiMode(): AiMode`; `setAndroidAiMode(mode: AiMode): void`; `isPhoneAiPlatform(): boolean`. Bridge: `status(): Promise<NativeStatus>`, `importModel(): Promise<NativeStatus>`, `load(): Promise<NativeStatus>`, `generate({requestId,messages,maxTokens}): Promise<NativeReply>`, `cancel({requestId}): Promise<void>`, `unload(): Promise<void>`. Messages use system/user/assistant string content. Reply contains `requestId`, `text`, `loadMs`, `firstTokenMs`, `generationMs`, `promptTokens`, `generatedTokens`; status contains `available`, `loaded`, `architecture`, and optional model `{name,bytes,sha256}`. Errors use codes `MISSING_MODEL`, `UNSUPPORTED_ARCH`, `INVALID_MODEL`, `INSUFFICIENT_SPACE`, `BUSY`, `LOAD_FAILED`, `CANCELLED`, `PROMPT_TOO_LONG`, `INFERENCE_FAILED`.

- [x] Add checks named `offline_never_fetches`, `online_never_calls_native`, `browser_keeps_ollama`, `invalid_native_reply_has_no_action`, `budget_keeps_current_constraints`, and `oversized_current_message_is_explicit_error` in the new reliability module. Assert zero calls to forbidden transports, unchanged calendar on invalid results, and preservation of system/current focus/current message/pending card.
- [x] Run `node scripts/check-android-ai.mjs`; confirm these checks fail before implementation.
- [x] Implement typed bridge and mode storage; extend `AiProvider`/trace with `native`; route native before any network transport and reuse `clean(parseReply(...))` in `askGroq`. Add optional abort signal to request options. Do not bypass existing focus validation or recovery restrictions.
- [x] Extend native message input with `required: boolean` and `priority: number` metadata used only for budgeting. Send rules/current focus/current message/pending card as required chunks; send older turns and separate calendar-fact chunks as optional, newest/relevant first. Native tokenizes the formatted prompt for the final 3840-token input ceiling (4096 minus 256). Trim optional chunks with lowest priority first, reapplying the chat template each time; never cut required chunks. Return `PROMPT_TOO_LONG` if mandatory content alone exceeds this budget. Apply a 64KiB pre-tokenization input ceiling and reject over-limit required fields.
- [x] Run new checks and `pnpm eval:chat`; require all existing 125 chat and 28 reliability checks plus new checks to pass.

## Task 2: Private model storage and native inference

**Interfaces:** `NativeEngine.load(String path)`, `generate(String requestId, String messagesJson, int maxTokens): String` (JSON with Task 1 reply fields), `cancel(String requestId)`, `unload()`. `ModelStore` stores the selected file and metadata atomically inside `filesDir/models`; paths never come from web messages. Plugin name is `LocalAi`, registered in `MainActivity` before its superclass initialization.

- [x] Add import checks for picker cancellation, truncated GGUF, size above 1GiB, insufficient free space, interrupted copy, and successful replacement. Assert previous active file/metadata survives every failure and temporary files are removed. Inject input streams/free-space probes to make JVM checks deterministic.
- [x] Add native device assertions for missing file, invalid file, exact request-ID cancellation, busy request, generation token ceiling, prompt ceiling, unload/reload, and repeated background cancellation; initially require failure from absent bridge.
- [x] Implement preparation script pinned to the revisions above; verify model SHA-256, record engine archive hash, preserve MIT/Apache license notices. Ignore downloads, native build caches, model weights, and device-result scratch data. Verify upstream root CMake and header APIs at the pin before integrating; do not copy the upstream Android example's newer toolchain requirements.
- [x] Build a single JNI library against the pinned source with static llama/ggml dependencies, position-independent code, CPU-only portable arm64 instructions, and disabled tools/examples/tests/server/app/OpenMP/OpenSSL/native-host tuning. Configure installed NDK/CMake explicitly; retain Android 16KiB page compatibility.
- [x] Implement exception-safe native ownership using model chat template, bounded batched prompt decoding, two threads, max 256 generated tokens, model end-of-generation stop, UTF-8-safe reply assembly, and a JSON grammar sampler. Never log prompt text or credentials. Check cancellation/deadline between prompt batches and decoding steps; use a 120-second generation deadline and report failure explicitly.
- [x] Implement Java worker serialization. Cancellation sets a native atomic flag immediately instead of queueing behind inference. Background/destroy cancels then unloads on the worker; release resources after decode exits; reject late completion. Report library-load errors without Activity crash. Picker uses ContentResolver; copy/validation runs off the UI thread; activate only after valid GGUF metadata and a successful native probe with space reserve.
- [x] Run preview JVM checks and assemble the JNI preview; run real-engine instrumentation after Task 5 supplies the model. Keep incomplete device assertions visibly pending until then.

## Task 3: App routing and lifecycle integration

**Consumes:** Task 1 bridge/mode helpers and existing `askGroq` result processing. **Produces:** explicit per-request provider selection and an AbortController/request epoch in App; changing mode or destroying/backgrounding invalidates the active epoch.

- [x] Add checks `mode_change_discards_delayed_reply`, `background_discards_delayed_action`, `cancel_is_request_scoped`, `same_provider_keeps_calendar`, and `malformed_native_json_never_writes`. Assert obsolete completions cannot append messages/cards or change events, and pending accepted calendar state is preserved.
- [x] Run these checks; verify failure before implementing epoch/lifecycle handling.
- [x] Select `native` for Android Offline and `cloud` for Android Online at request start; browser keeps current selection. Cancel and invalidate active inference on mode change/background/unmount; clear thinking state in all failure paths. Prevent native errors from triggering cloud recovery or desktop Ollama fallback.
- [x] Disable preview speech initialization, Kokoro warmup, hands-free, microphone controls/permissions, and speech playback across all entry points; retain browser behavior. Provide a deliberate Cancel action while native inference is running.
- [x] Run new checks, `pnpm eval:chat`, and `pnpm exec tsc --noEmit`; require all pass.

## Task 4: Android settings and preview build

**Consumes:** Tasks 1–3. **Produces:** Settings mode selector and model status/import controls, accurate provider badge, and `previewDebug` package.

- [x] Add checks `fresh_install_defaults_offline`, `missing_model_offers_import`, `missing_cloud_credentials_offers_setup`, `online_failure_does_not_fallback`, and `preview_has_no_voice_assets_or_dev_key`. Assert clear setup guidance, persisted mode, and no hidden provider change.
- [x] Implement Android settings and status using existing visual styles; distinguish On this phone from Cloud AI, show importing/loading/cancelled/errors, and keep mode changes effective immediately. Hide PC Ollama controls on Android. Show model source/license in setup details.
- [x] Add `standard` and `preview` flavor packaging; preview ID suffix `.preview`, app/title label `pal.do Preview`, arm64-v8a, and native AI enabled. Existing application build path remains available. Remove microphone permissions from preview's merged manifest and disable model backup for preview.
- [x] Add repeatable web build/sync and Gradle `assemblePreviewDebug` commands. Audit built JS/assets for development-key leakage without printing any key; verify merged manifest, package ID, offline web assets, and native-library page alignment.
- [x] Run `pnpm exec tsc --noEmit`, `pnpm build`, new checks, and `git diff --check`; build preview APK and report any actual warnings.

## Task 5: Connected phone installation and acceptance

**Consumes:** Verified preview APK and verified model from previous tasks. **Produces:** installed app, actual device results and APK path; online/airplane-mode checks explicitly marked passed or pending.

- [x] Recheck authorized connected device and personal-profile storage. Confirm estimated APK/model copy leaves at least 1GB free. Stop transfer if reserve cannot be met; ask user to free space without deleting files.
- [x] Install preview over USB without uninstall/data clearing. Transfer one verified model via debug `run-as` private storage, checking device-side SHA-256; remove any temporary transfer copy created by this task only. Activate using the same ModelStore validation path as import.
- [x] Run native instrumentation against preview: actual generation, invalid model, 256-token cap, prompt budgeting, cancellation, unload/reload/background transitions. Record load time, first-token time, total time, peak app memory and any failures, with no unrelated phone-data collection.
- [x] Open preview for user interaction. Replay seminar correction and exam/review/removal sequences from the spec three times, recording intermediate cards and final calendar assertions. Separate deterministic scheduling checks from language-quality results.
- [x] Test Online with a user-entered key or configured proxy; never inject the PC development key into APK. If no cloud setup is present, report this exact pending step and offer setup instructions.
- [x] Ask user to enable airplane mode, then repeat real local generation and one scheduling check. Leave network switching under user control; do not claim this acceptance step passed before it does.
- [x] Re-run web/reliability/type/build checks. Run a fresh independent code review according to the selected execution skill and fix actionable issues before claiming completion.
- [x] Write `docs/android-preview.md` with reproducible commands, installed APK path/model checksum, actual measured results, open failures and text-only/0.5B limitations. No speed, battery, quality, or hackathon-win guarantees.

## Self-review

Spec coverage: native boundary/storage/resources (Tasks 1–2); explicit modes and shared validation (Tasks 1, 3); settings, text-only and isolated packaging (Tasks 3–4); installation, device replay and measurements (Task 5). All five Review Focus conditions have named checks. Interface/error names are consistent between tasks. Existing project behavior and uncommitted work are preserved.

## Execution choice

Recommended: implement here using `executing-plans`, then obtain a fresh independent review before final acceptance. The transport, JNI lifecycle, and app cancellation changes share interfaces, so keeping implementation in one session reduces coordination work; the independent review provides a separate check on native and routing risks.

## Execution record

Completed on the connected phone. See `docs/android-preview.md` for measured results and implementation decisions. Final phone suite 10/10; source checks 125 rules +29 reliability +16 Android checks, session/voice and TypeScript pass;8 JVM import checks pass. Web/preview builds and package/16KB audits pass. Check names were consolidated into those suites; picker result/resume ordering is controlled by instrumentation with real ContentResolver/native validation. Native baseline failed for missing model rather than missing bridge. Cloud used the user-authorized key in private runtime Settings, not APK assets. Calendar facts use the existing compact context as one optional chunk rather than separate event messages. No commits/pushes.
