import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function run(cmd, args, cwd) {
  const p = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env }
  })
  p.on('exit', code => { if (code !== 0) process.exit(code) })
  return p
}

const backend = run('node', ['--watch', 'index.js'], join(__dirname, 'backend'))
const frontend = run('npm', ['run', 'dev'], join(__dirname, 'frontend'))

process.on('SIGINT', () => { backend.kill(); frontend.kill(); process.exit(0) })
