# pal.do Android preview

The preview installs separately as **pal.do Preview** (`com.paldo.app.preview`). It has the full app: chat, voice and "Hi {pal}" hands-free, the Study library, and an AI mode setting (Auto, Online, Offline). The APK includes Qwen; on first launch it copies and verifies the model into private storage automatically. Calendar data and library files stay on the phone.

## On the phone

1. Open pal.do Preview and finish the short onboarding.
2. **AI mode** (Settings):
   - **Auto** (default): the cloud AI when online, the AI on this phone when offline or when the shared free cloud quota runs out.
   - **Online**: cloud only.
   - **Offline**: the phone only.

   On the phone model, Pal's own rules answer everything they understand (dates, times, yes/no, timers, overlaps), and the model only gets what they don't. The phone model needs a CPU with ARMv8.2 dot-product and fp16 (most phones since 2019). Others report "unsupported" and Auto uses the cloud.
3. **Cloud:** the build talks to the hosted proxy in `VITE_GROQ_PROXY_URL` (see `docs/deploy-vercel.md`); nobody needs a key. A key entered in Settings goes straight to Groq and is stored on the phone only.
4. **Voice:** tap the mic, or turn on Hands-free in Settings and say "Hi Rei". The first time, the ~76 MB speech model downloads from Hugging Face (Wi-Fi recommended), then works offline. Pal speaks with the phone's own text-to-speech. Hands-free listens only while the app is open.
5. **Model replacement:** Settings → Model and prototype details → Import a different model. Keep at least 1 GiB free beyond a model copy.

Switching mode preserves the calendar and cancels the active reply. Backgrounding cancels generation and releases the loaded model. Reminders, timers and study rounds use the "Reminders and timers" notification channel with Pal's own sound.

## Build on Windows

Prerequisites: the project's pnpm dependencies, JDK 21, Android SDK 36, NDK 28.2.13676358, and CMake 3.22.1. This preview targets arm64 phones; local model import requires Android 8/API 26 or later.

From the repository root:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
pnpm install
pnpm android:prepare-ai
pnpm android:preview
node scripts/check-android-package.mjs
```

The preparation command downloads pinned upstream source and verifies the model checksum. Downloads remain in ignored `.cache/android-ai/`. The preview build verifies and copies the model into ignored `android/app/src/preview/assets/models/`, then bundles it uncompressed. Model weights stay out of Git. It preserves the engine and model licenses in APK assets.

APK: `android/app/build/outputs/apk/preview/debug/app-preview-debug.apk`.

Install with the Android SDK's `adb install -r` command. This updates only the preview package without clearing its data. Open the app: the included model sets up automatically into private storage. Optional replacement uses Android's file picker. The APK is about 502 MB and first setup also needs space for the private model copy; installed footprint is roughly 1 GB plus app data.

For laptop-to-phone development setup, `node scripts/configure-android-online.mjs` transfers the existing local development key through standard input into a temporary private preview file. Run only on an authorized connected device. The `CloudSetupTest` instrumentation consumes and deletes that temporary file, configures Settings storage, and checks a real cloud reply. It never embeds the key in the APK. Rotate any key shared in a chat or screenshot.

## Pinned dependencies

| Item | Pin |
| --- | --- |
| llama.cpp | `f2cc7282ce0042641df55e0e563b75e824e2b647` |
| Qwen2.5-0.5B-Instruct-GGUF | `9217f5db79a29953eb74d5343926648285ec7e67` |
| Included asset | `models/qwen2.5-0.5b-instruct-q4_k_m.gguf` |
| Bytes | 491400032 |
| SHA-256 | `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |

[Official model and license](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/9217f5db79a29953eb74d5343926648285ec7e67), [engine source](https://github.com/ggml-org/llama.cpp/tree/f2cc7282ce0042641df55e0e563b75e824e2b647). License copies and attribution are in `android/app/src/main/assets/licenses/`.

## Verification

```powershell
pnpm eval:chat
pnpm check:android-ai
pnpm exec tsc --noEmit
pnpm build
pnpm android:preview
node scripts/check-android-package.mjs
git diff --check
```

Phone checks are in `android/app/src/androidTest/java/com/paldo/app/ai/`. Instrumentation temporarily replaces the preview's calendar/chat with fixtures and restores it in `finally`; it never clears app data. Run classes individually: `AppDeviceTest` includes an airplane-mode acceptance method which deliberately requires the user to enable airplane mode first.

### Measurements and current acceptance

Test device: Samsung Galaxy A32 5G, Android 13, arm64, 8 GB reported RAM.

- Real cloud reply: passed, HTTP 200 from `qwen/qwen3.8-27b` on Groq using the phone's saved key.
- First successful optimized native smoke run: model load 651 ms; first token 1394 ms; generation 18281 ms for 120 tokens; PSS at completion 634870 KiB. These are a single observation, not a speed guarantee or peak measurement.
- A later unconstrained smoke prompt failed to finish valid JSON within the reply limit. It returned an error; partial output was not accepted as a calendar action. Subsequent constrained smoke measurements and full device replay results are recorded below when verified.
- Short constrained native smoke reply: load 764 ms; first token 2636 ms; generation 6154 ms for 20 tokens. Sampled peak process PSS was 826355 KiB (about 807 MiB), sampled every 250 ms during instrumentation. Sampling can miss brief peaks and includes test overhead.
- Actual device replay found and reproduced a removal reference bug for “those review sessions”; the isolated regression passes after correction. All three complete seminar/exam/review/removal replays subsequently passed on the phone.
- Mode switching and background cancellation: passed three cycles each; obsolete native completions did not append chat or calendar actions.
- User-controlled airplane mode with Wi-Fi off: passed real native generation with zero fetches, plus confirmed Seminar today 3–5pm.
- Independent review completed. The original reviewer hit a usage limit; a fresh reviewer continued it. Picker resume, cancellation at model activation, task-hour preservation during reflow, and a delayed weather reply were fixed and verified with failing regressions followed by passing checks.
- Final phone suite: **10/10 passed** in 398.221 seconds, including three scheduling replays, three mode/background cancellation cycles each, valid and invalid model-import callbacks with real ContentResolver/native validation, missing/invalid native model errors, prompt/token ceilings, unload/reload, airplane mode, and offline startup. The picker tests control Android's result/resume ordering; they do not automate taps inside the external system file picker.
- Final source checks: 125 chat rules, 29 shared reliability checks, 16 Android transport/setup checks, session/voice checks, and TypeScript passed. Eight model-import JVM checks passed. Web and preview builds passed; package and 16 KB alignment audits passed. Build tools reported existing Gradle deprecation/flat-directory warnings and Vite plugin timing warnings.
- Earlier unbundled APK: 25637791 bytes; SHA-256 `1e1c1f693e7f653a7c8969b6d85f3d6150a065d22727527b939c6fe845d6ef56`. Superseded by the bundled build below.

### Bundled model follow-up (approved October 12, 2026)

- Qwen now ships inside the preview APK. The same atomic ModelStore path checks the pinned SHA, verifies the native model, and activates it. Startup reuses an existing selected model and shares one setup attempt with waiting chat requests.
- Fresh private-store device check passed: read the real APK asset, automatic native setup, verified SHA, real local generation, and reuse without another copy. Initial setup measured 8034 ms, including test Activity startup. It does not benchmark every device or automate a clean app installation by clearing user data.
- Final bundled APK: 502038791 bytes (about 502 MB); SHA-256 `376c65cd4830f8fd4c1b768dd2992fa71730916c0450746daa8c821235b65ee7`. Installed as an update preserving app data. The final fresh-store setup rerun measured 9000 ms.
- Four bundle unit checks passed (fresh setup, existing selection, wrong hash, cancellation/retry), alongside eight existing import checks. Android reliability checks increased to 18 and include shared setup/generation sequencing plus retry after a cancelled attempt settles while foreground.
- Independent review found the quick-resume retry race. Its regression failed before the fix and passes after it. Final bundled phone run passed all three test groups in 451.243 seconds: fresh APK setup/local generation/reuse, three background/mode cycles each, and all three seminar/exam/review/removal replays. Source checks, both builds, 12 JVM checks, key/model packaging audit, and 16 KB alignment checks also passed.
- Deferred inherited limitation: a forced process termination during first setup can leave a partial copy. Normal cancellation cleans up, but startup does not yet prune files abandoned by process death.

## Implementation decisions

- Kept the approved current checkout and uncommitted work; no commits or pushes. PowerShell commands and an ignored ledger replace the skill's Bash bookkeeping. Cost: the verification record remains local until the user saves or commits it.
- Native import requires API 26/Android 8 for atomic file activation; the existing minimum API 24 build remains available. Cost: Android 7 cannot import a local model. The tested phone uses Android 13.
- Used the pinned engine's `load_mode=MMAP` API, skipped unused upstream examples/tools during Windows extraction, and selected the installed JDK 21 explicitly. Cost: setup depends on those recorded pins and tool versions.
- Preserved the ignored progress ledger because no commits were authorized. Cost: local scratch data remains; it is excluded from Git.
- Used the explicitly supplied laptop key only for private runtime setup on the phone. Cost: public distribution still needs a proxy or each user's own key; the shared key should be rotated.
- Calendar facts are compacted by the shared context builder and sent as one optional native chunk; required rules, focus, identity, pending card, and current request survive trimming. Cost: very long input can drop calendar context and require clarification.
- Planned check names were grouped into the existing reliability checks and device suites. Native baseline failure was a missing model rather than an absent bridge. Cost: the recorded test groups establish bounded prototype behavior, not exhaustive coverage of every model or Android device.

## Limits

This is a debug prototype, not a public release. Native inference uses CPU only (two threads for writing, four for reading the prompt), keeps the unchanged start of the prompt between requests, 4096 context tokens, at most 256 output tokens, one active request, and a 120-second generation deadline. A 0.5B model can misunderstand Taglish or fail to finish a response. Scheduling corrections, time calculation, confirmation cards, and exact removal use shared app logic; these deterministic successes do not establish general language quality.

Background listening, larger models, CPUs without dot-product, battery benchmarking, and app-store distribution are outside this prototype. **Google Play:** a ~515 MB APK is over Play's base size limit; before publishing, move the Qwen model to a first-run download or Play Asset Delivery. The cloud proxy is ready in `api/` but deploying it is up to you (`docs/deploy-vercel.md`).
