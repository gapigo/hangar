import { spawn, execSync } from 'child_process'
import { networkInterfaces } from 'os'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const useTunnel = process.argv.includes('--tunnel')
const isDev = process.argv.includes('--dev')
const PORT = process.env.PORT || '3333'

function getLanIP() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces) {
      if (i.family === 'IPv4' && !i.internal) return i.address
    }
  }
  return 'localhost'
}

const lanIP = getLanIP()

console.log('✈️  Hangar starting...')

// Build frontend if not built
const distPath = path.join(__dirname, 'frontend', 'dist', 'index.html')
if (!existsSync(distPath)) {
  console.log('📦  Building frontend...')
  execSync('npm run build', { stdio: 'inherit', cwd: __dirname })
}

// Start backend
const backendArgs = isDev ? ['--watch', 'backend/index.js'] : ['backend/index.js']
const backend = spawn('node', backendArgs, {
  stdio: 'inherit',
  cwd: __dirname,
  env: { ...process.env, PORT }
})

backend.on('exit', (code) => {
  if (code !== 0 && code !== null) console.error('Backend exited with code', code)
  process.exit(code || 0)
})

// Print access info after backend is up
setTimeout(() => {
  console.log('')
  console.log('──────────────────────────────')
  console.log(`📡  Local:  http://localhost:${PORT}`)
  console.log(`📡  LAN:    http://${lanIP}:${PORT}`)
  if (useTunnel) console.log('🌐  Tunnel: starting...')
  console.log('──────────────────────────────')
}, 2000)

// Cloudflare tunnel
if (useTunnel) {
  import('cloudflared').then(({ bin }) => {
    const tunnel = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const capture = (data) => {
      const str = data.toString()
      const match = str.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match) {
        const url = match[0]
        let token = ''
        const authPath = path.join(process.env.HOME || process.env.USERPROFILE, '.hangar', 'auth.json')
        if (existsSync(authPath)) {
          try { token = JSON.parse(readFileSync(authPath, 'utf8')).token || '' } catch {}
        }
        const publicUrl = token ? `${url}?token=${token}` : url
        console.log(`\n🌐  Public: ${publicUrl}`)
        import('qrcode-terminal').then(({ default: qr }) => {
          qr.generate(publicUrl, { small: true })
        }).catch(() => {})
        const hangarDir = path.join(process.env.HOME || process.env.USERPROFILE, '.hangar')
        mkdirSync(hangarDir, { recursive: true })
        writeFileSync(path.join(hangarDir, 'tunnel.json'), JSON.stringify({ url, publicUrl, active: true }))
      }
    }
    tunnel.stdout.on('data', capture)
    tunnel.stderr.on('data', capture)
    process.on('exit', () => { try { tunnel.kill() } catch {} })
  }).catch(() => console.error('cloudflared not installed. Run: npm install cloudflared -D'))
}

process.on('SIGINT', () => { backend.kill(); process.exit(0) })
process.on('SIGTERM', () => { backend.kill(); process.exit(0) })
