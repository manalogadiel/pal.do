import { loadEnv } from 'vite'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

// The key from the environment (GROQ_API_KEY) or the local .env; it goes to the phone over stdin, never as an argument
const key = process.env.GROQ_API_KEY || loadEnv('development', process.cwd()).VITE_GROQ_API_KEY
if (!key || !/^gsk_[A-Za-z0-9]+$/.test(key)) throw new Error('No valid local Groq key is configured')
// adb from ANDROID_HOME, or the default SDK place on Windows / macOS / Linux
const sdk = process.env.ANDROID_HOME || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA ?? '', 'Android/Sdk') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Android/sdk') : path.join(os.homedir(), 'Android/Sdk'))
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const result = spawnSync(adb, ['shell', '-T', 'run-as', 'com.paldo.app.preview', 'sh', '-c', "'umask 077; cat > files/online-key.tmp'"], { input: key, encoding: 'utf8' })
if (result.status !== 0) throw new Error('Private phone configuration transfer failed')
console.log('Key transferred privately for runtime setup; no key included in command arguments or APK')
