import { loadEnv } from 'vite'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const key = loadEnv('development', process.cwd()).VITE_GROQ_API_KEY
if (!key || !/^gsk_[A-Za-z0-9]+$/.test(key)) throw new Error('No valid local Groq key is configured')
const adb = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe')
const result = spawnSync(adb, ['shell', '-T', 'run-as', 'com.paldo.app.preview', 'sh', '-c', "'umask 077; cat > files/online-key.tmp'"], { input: key, encoding: 'utf8' })
if (result.status !== 0) throw new Error('Private phone configuration transfer failed')
console.log('Key transferred privately for runtime setup; no key included in command arguments or APK')
