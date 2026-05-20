import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = join(__dirname, 'backend')
const FRONTEND_DIR = join(__dirname, 'frontend')
const PORT_FILE = join(__dirname, '.port')
const isWindows = process.platform === 'win32'

function run(cmd, args, cwd, env) {
  const p = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: isWindows,
    env: { ...process.env, FORCE_COLOR: '1', ...env },
  })
  p.on('error', (err) => {
    console.error(`[${cmd}] Failed: ${err.message}`)
  })
  return p
}

console.log('Hangar starting...')

const backend = run('node', ['--watch', 'index.js'], BACKEND_DIR)

let frontend = null

// Poll for .port file written by backend once it finds an available port
const poll = setInterval(() => {
  if (frontend) { clearInterval(poll); return }
  try {
    if (existsSync(PORT_FILE)) {
      const port = readFileSync(PORT_FILE, 'utf8').trim()
      if (port) {
        clearInterval(poll)
        console.log(`Backend running on port ${port}`)
        frontend = run('npm', ['run', 'dev'], FRONTEND_DIR, {
          VITE_API_PORT: port,
        })
      }
    }
  } catch {}
}, 300)

function cleanup() {
  clearInterval(poll)
  backend.kill('SIGTERM')
  if (frontend) frontend.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
