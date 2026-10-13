// Runs an Android script for this computer: the .ps1 on Windows, the .sh twin on macOS/Linux.
// Usage: node scripts/android.mjs <prepare-android-ai|build-android-preview> [args]
import { spawnSync } from 'node:child_process'

const [name, ...args] = process.argv.slice(2)
const result = process.platform === 'win32'
  ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `scripts/${name}.ps1`, ...args], { stdio: 'inherit' })
  : spawnSync('bash', [`scripts/${name}.sh`, ...args], { stdio: 'inherit' })
process.exit(result.status ?? 1)
