# Android offline AI prototype

## Intended outcome

Run pal.do's scheduling assistant entirely on the user's Samsung Galaxy A32 5G when Offline mode is selected. Preserve online cloud AI as a selectable mode in the same APK. Reuse the current React interface and the shared conversation, scheduling, validation, and confirmation logic.

This is a new native model subsystem. This design is the review artifact for that subsystem; implementation and device installation follow its approval and the implementation plan.

## Confirmed environment

- Connected device: Samsung SM-A326B, Android 13, supports arm64-v8a.
- User reports 8GB RAM. Device reports approximately 7.4GiB total and 3.7GiB available during inspection.
- Device data partition has approximately 3.3GB free. Keep one model; do not download voice models for the prototype.
- Java 21, Android SDK platform 36, NDK 28.2.13676358, and CMake 3.22.1 are installed on the PC.
- Existing Capacitor project uses minimum Android API 24 and target API 36.
- No com.paldo.app package was found in the personal profile. Other profiles were not inspected.
- Existing desktop chat reliability changes are uncommitted and must be preserved. Do not commit or push as part of this prototype.

## Approach and alternatives

**Selected approach:** embed llama.cpp behind a native Capacitor plugin. It supports Android and the GGUF format used by the selected Qwen model. Native calls avoid requiring a separately running model server on the phone.

**Alternative: phone-local HTTP server.** This could resemble the existing Ollama connection, but adds server lifecycle, address, and background execution work to an otherwise self-contained app.

**Alternative: LiteRT-LM.** This supports native inference, but requires a compatible model export and a separate model-format integration. It is unnecessary for the first GGUF/Qwen prototype.

Reference: [llama.cpp Android integration](https://github.com/ggml-org/llama.cpp/blob/master/docs/android.md), [Capacitor Android plugins](https://capacitorjs.com/docs/plugins/android).

## First model and resource limits

- Initial model: official Qwen2.5-0.5B-Instruct, Q4_K_M GGUF, published file size approximately 491MB.
- Source: [Qwen's model repository](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/main).
- Initial model filename: `qwen2.5-0.5b-instruct-q4_k_m.gguf`. Published SHA-256: `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`, from the [upstream file details](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/blob/main/qwen2.5-0.5b-instruct-q4_k_m.gguf).
- Keep the model separate from the APK in app-private storage. For the first device test, transfer the verified file over USB to avoid a second phone download. Support importing a GGUF through Android's file picker for normal use.
- Store display name, file size, checksum, and selected file separately from the model bytes. Verify the initial file against its upstream SHA-256 before transfer. Verify GGUF metadata and size before activating an imported file.
- Pin the engine revision and model source revision in the implementation's reproducible setup scripts. Retain upstream licenses; exclude downloaded weights and build outputs from Git.
- Start with CPU inference, a 4096-token maximum context, at most 256 generated tokens, and two worker threads. These are starting limits to measure on the actual phone, not speed or quality guarantees. No GPU dependency for the first build.
- Budget the prompt within the context: preserve the system rules, current request, current user message, and pending card; trim oldest history and less relevant calendar entries first. Reject an oversized current request with a useful explanation.
- Keep only one loaded model and one active inference. Release model memory when the app enters the background, after cancelling active generation. Check cancellation between decoding steps and while processing prompt batches.

## Native engine boundary

Add a native Android plugin with these app-facing operations:

- `status`: return model availability, loaded state, and supported device architecture.
- `importModel`: open the Android file picker, copy into a temporary app-private file, validate it, then atomically activate it. Preserve the prior selected model on failure or cancellation.
- `load`: load the selected model off the Android UI thread.
- `generate`: accept bounded system/history/user messages and a request ID; format them using the model's chat template; return raw reply text and timing metadata.
- `cancel`: cancel only the matching active request. Ignore late results after cancellation.
- `unload`: release native model and context resources after generation has stopped.

An asynchronous worker owns the model/context. Native pointers stay inside the plugin. Validate all native inputs and report missing model, unsupported architecture, invalid file, insufficient space, load failure, cancellation, and inference failure as structured errors.

The native engine returns a candidate response. It cannot directly add, remove, or move calendar entries.

## App integration and mode selection

Introduce a small TypeScript adapter for the native plugin and reuse the existing compact local prompt and reply validation. Extract shared response parsing if needed so both Ollama and the native engine use the same action checks.

On Android, Settings offers:

1. **Offline — On this phone:** native engine only. No cloud or desktop Ollama calls for chat. The model remains usable without a network connection. Show model import/load status and readable errors.
2. **Online — Cloud AI:** existing cloud chain only. If unavailable, explain the failure and offer Offline mode; do not silently send the request to another provider.

Default this preview to Offline mode. Keep existing desktop/browser Ollama support. Mode switching must update subsequent chat requests without requiring an app restart. Do not copy private cloud credentials into source, APK assets, build logs, or device-test reports. Online testing uses an existing configured proxy or a key the user enters through Settings.

For the first prototype, the chat interface is text-only: do not automatically load speech recognition or speech synthesis model assets, request microphone access, or enable voice mode. This limits simultaneous model memory and storage use. Full offline voice is outside this first prototype.

## Application state and confirmation

Continue using the shared conversation focus and authoritative calendar facts. Greetings and explicit corrections remain deterministic. The app calculates study times and renders real cards. Accepted actions modify only the exact card targets. Malformed, repeated rejected, or contradictory native output falls back to a useful app response.

Keep the calendar and chat persisted locally. Selecting a different AI mode does not clear the calendar. A cancelled inference cannot later display a reply or execute a pending action.

## Preview packaging and device operations

- Build a debug preview with a distinct application ID, com.paldo.app.preview, and visible name pal.do Preview.
- The preview uses separate app storage. Do not overwrite another installed application, clear device data, modify other profiles, or uninstall anything as part of testing.
- Limit the native binary to arm64-v8a for this prototype. Preserve a build path for the existing application.
- Sync the current web build into Capacitor, build the preview, install it over USB, and copy the verified model into preview-private storage using the debug application's supported development access.
- Confirm available device storage before copying. Keep at least 1GB free after the model and app are installed; if this cannot be met, pause the transfer and ask the user to free space.
- No public release, app-store upload, root access, or permanent device configuration changes are part of this work.

## Verification and acceptance

1. Existing 125 chat checks, 28 reliability checks, TypeScript check, and web build still pass.
2. Adapter tests prove Offline chat cannot call cloud/Ollama and Online chat cannot call the native engine. Unknown or invalid native results cannot produce a calendar write.
3. Native load, cancellation, unload, invalid-model errors, and app background transitions have deterministic tests where possible and are checked on the connected phone.
4. The installed preview shows a ready local model and answers a prompt without a PC model server.
5. Replay the supplied offline correction sequence: greeting; new event; not an exam; no; seminar later; 3–5pm. Confirm the resulting event card is Seminar today, 3–5pm, with no old App Dev details.
6. Replay the exam/review sequence: App Dev exam tomorrow 4–6pm; two hours of review before the exam; real proposal; exact group removal preserves the real exam. Check intermediate cards and final state.
7. Repeat the two focused sequences three times and report failed assertions. Separate deterministic scheduling correctness from model language quality.
8. With the user placing the phone in airplane mode, repeat a real generation and scheduling check. Keep network switching under the user's control. Do not use desktop Ollama as evidence of phone-local inference.
9. Record model load time, first-token time, total generation time, peak app memory, and crashes/timeouts for the initial 0.5B model. Do not claim battery performance from a short smoke test.
10. Report the APK path, actual device results, and any outstanding failures. Consider a larger model only after these measurements and another resource check.

## Scope limits

This prototype establishes native offline text inference and online/offline routing. It does not promise that a 0.5B model understands arbitrary Taglish reliably. Larger models, offline voice, automatic model downloads, background assistant services, Play Store release, and support for additional Android architectures are later work.
