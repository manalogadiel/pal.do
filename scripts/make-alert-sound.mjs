// Writes Pal's alert sound: the same four-note chiptune as the in-app alarm (src/lib/chime.ts), played twice.
// Made from scratch here, so there's no audio licence to track. Run: node scripts/make-alert-sound.mjs
import { mkdirSync, writeFileSync } from 'node:fs'

const RATE = 22050
const A5 = 880, D5 = 587.33
// [frequency, start s, length s], twice with a short pause
const phrase = [[A5, 0, 0.12], [A5, 0.2, 0.12], [D5, 0.4, 0.1], [A5, 0.52, 0.22]]
const notes = [...phrase, ...phrase.map(([f, t, l]) => [f, t + 1.0, l])]
const seconds = 1.9
const samples = new Float32Array(Math.ceil(seconds * RATE))

for (const [freq, start, len] of notes) {
  const from = Math.floor(start * RATE), to = Math.min(samples.length, Math.floor((start + len) * RATE))
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE
    // soft square: odd harmonics only up to the 7th, so it's chiptune without the harshness
    let v = 0
    for (const h of [1, 3, 5, 7]) v += Math.sin(2 * Math.PI * freq * h * t) / h
    // quick attack, exponential release
    const env = Math.min(1, t / 0.01) * Math.exp(-3.2 * (t / len))
    samples[i] += v * env * 0.45
  }
}

const data = Buffer.alloc(samples.length * 2)
samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2))
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(data.length, 40)
const wav = Buffer.concat([header, data])

for (const dir of ['android/app/src/main/res/raw', 'public/sounds']) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/paldo_alert.wav`, wav)
}
console.log(`paldo_alert.wav: ${(wav.length / 1024).toFixed(0)} KB, ${seconds}s`)
