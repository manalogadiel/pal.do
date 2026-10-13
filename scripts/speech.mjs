import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const service = path.join(root, 'services/tts')
const localPython = path.join(service, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const python = process.env.PYTHON || (existsSync(localPython) ? localPython : process.platform === 'win32' ? 'python' : 'python3')
const child = spawn(python, [path.join(service, 'server.py'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: process.env })
child.on('error', err => { console.error(`Speech service: ${err.message}. Install services/tts/requirements.txt first.`); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
