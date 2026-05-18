import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = join(__dirname, 'backend')
const FRONTEND_DIR = join(__dirname, 'frontend')
const isWindows = process.platform === 'win32'

function run(cmd, args, cwd, label) {
  const p = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  p.on('error', (err) => {
    console.error(`[${label}] Failed to start: ${err.message}`)
  })
  p.on('exit', (code, signal) => {
    if (code !== null && code !== 0 && signal !== 'SIGTERM') {
      console.error(`[${label}] Exited with code ${code}`)
    }
  })
  return p
}

console.log('Hangar starting...')

const backend = run('node', ['--watch', 'index.js'], BACKEND_DIR, 'backend')
const frontend = run('npm', ['run', 'dev'], FRONTEND_DIR, 'frontend')

function cleanup() {
  backend.kill('SIGTERM')
  frontend.kill('SIGTERM')
}

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
