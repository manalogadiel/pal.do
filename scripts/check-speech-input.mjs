import { createServer } from 'vite'
import assert from 'node:assert/strict'
const vite = await createServer({ configLoader: 'runner', server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { readRecognitionResults } = await vite.ssrLoadModule('/src/lib/speech-input.ts')
  const result = (text, isFinal) => Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal })
  assert.deepEqual(readRecognitionResults([result('May plano ako', true), result('bukas sa mall', false)]), { final: 'May plano ako', text: 'May plano ako bukas sa mall' })
  assert.deepEqual(readRecognitionResults([result('May plano ako', true), result('bukas sa library', false)]), { final: 'May plano ako', text: 'May plano ako bukas sa library' }, 'Interim corrections replace the prior guess')
  assert.deepEqual(readRecognitionResults([result('Pagshoshopping bukas', false)]), { final: '', text: 'Pagshoshopping bukas' }, 'A service ending without a final result must retain its last partial transcript')
  console.log('speech input: complete live results, interim corrections, and partial-only endings pass')
} finally { await vite.close() }
