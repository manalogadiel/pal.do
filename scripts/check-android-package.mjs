import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'

const assets = await readdir('dist-android/assets')
const modelHash = createHash('sha256')
for await (const chunk of createReadStream('android/app/src/preview/assets/models/qwen2.5-1.5b-instruct-q4_k_m.gguf')) modelHash.update(chunk)
assert.equal(modelHash.digest('hex'), '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e', 'Bundled Qwen must match the pinned model')
const config = JSON.parse(await readFile('android/app/src/main/assets/capacitor.config.json', 'utf8'))
assert.equal(config.loggingBehavior, 'none', 'Native bridge logging must not record chat prompts')
// Voice ships its detector and runtime; Whisper downloads on first use and the unused Kokoro model never ships
assert(existsSync('dist-android/vad/silero_vad_v5.onnx'), 'Voice detector must be bundled')
assert(existsSync('dist-android/kokoro/ort/ort-wasm-simd-threaded.jsep.wasm'), 'ONNX runtime must be bundled')
for (const f of ['models.json', 'melspectrogram.onnx', 'embedding_model.onnx', 'rei.onnx', 'diel.onnx', 'jhyvie.onnx', 'jaypee.onnx']) assert(existsSync(`dist-android/wakeword/${f}`), `Wake-word engine must be bundled (${f})`)
assert(!existsSync('dist-android/whisper') && !existsSync('dist-android/kokoro/models') && !existsSync('dist-android/kokoro/voices'), 'Whisper and Kokoro models must not be bundled')
assert(!assets.some((name) => /^ort-wasm.*\.wasm$/.test(name)), 'Only one copy of the ONNX runtime')
for (const name of assets.filter((name) => name.endsWith('.js'))) {
  assert(!/gsk_[A-Za-z0-9]{20,}/.test(await readFile(`dist-android/assets/${name}`, 'utf8')), 'Cloud key detected in build')
}
const manifest = await readFile('android/app/build/intermediates/merged_manifests/previewDebug/processPreviewDebugManifest/AndroidManifest.xml', 'utf8')
assert(manifest.includes('package="com.paldo.app.preview"'))
assert(manifest.includes('android.permission.RECORD_AUDIO'), 'Hands-free needs the microphone')
assert(manifest.includes('android:allowBackup="false"'))
console.log('Android package: separate ID, voice detector and wake-word engine bundled, no Whisper/Kokoro models, no embedded cloud key, no backup — pass')
