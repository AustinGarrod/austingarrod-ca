// No game, UnityPy, wiki downloads, or additional Python packages are needed.
import { spawnSync } from 'node:child_process'
const commands = [
  [process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'), ['-S', '-m', 'unittest', 'discover', '-s', 'tests/tooling', '-p', '*_test.py', '-v']],
  [process.execPath, ['--test', 'tests/tooling/wiki-priorities.test.mjs']],
  [process.execPath, ['--test', 'tests/tooling/runtime-notices.test.mjs']],
]
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}
