import { spawn } from 'child_process'
import { EventEmitter } from 'events'

class SessionManager extends EventEmitter {
  constructor() {
    super()
    this.sessions = new Map()
  }

  start(project, promptText) {
    if (this.sessions.has(project.id)) this.stop(project.id)

    const harness = project.harness || 'omp'
    let cmd, args

    if (harness === 'omp') {
      cmd = 'omp'
      args = ['--model', project.model, '--cwd', project.path, '--new']
    } else if (harness === 'claude') {
      cmd = 'claude'
      args = ['--cwd', project.path]
    } else if (harness === 'codex') {
      cmd = 'codex'
      args = ['--cwd', project.path]
    } else {
      cmd = harness
      args = []
    }

    const proc = spawn(`${cmd} ${args.join(' ')}`, {
      cwd: project.path,
      shell: true,
      env: { ...process.env },
      windowsHide: false,
    })

    const session = { process: proc, clients: new Set(), output: [] }
    this.sessions.set(project.id, session)

    if (promptText) {
      setTimeout(() => {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write(promptText + '\n')
        }
      }, 3000)
    }

    const onData = (data) => {
      const text = data.toString()
      session.output.push({ ts: Date.now(), text })
      if (session.output.length > 500) session.output.shift()
      this.broadcast(project.id, { type: 'output', text })
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)

    proc.on('close', (code) => {
      this.sessions.delete(project.id)
      const status = code === 0 ? 'done' : 'paused'
      this.emit('status', project.id, status)
      this.broadcast(project.id, { type: 'exit', code, status })
    })

    proc.on('error', (err) => {
      this.sessions.delete(project.id)
      this.emit('status', project.id, 'paused')
      this.broadcast(project.id, { type: 'error', message: err.message })
    })

    this.emit('status', project.id, 'running')
  }

  stop(id) {
    const s = this.sessions.get(id)
    if (!s) return
    try { s.process.kill() } catch {}
    this.sessions.delete(id)
    this.emit('status', id, 'idle')
  }

  send(id, text) {
    const s = this.sessions.get(id)
    if (!s || !s.process.stdin || s.process.stdin.destroyed) return
    s.process.stdin.write(text + '\n')
  }

  addClient(id, ws) {
    const s = this.sessions.get(id)
    if (!s) { ws.close(); return }
    s.clients.add(ws)
    for (const msg of s.output) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'output', text: msg.text }))
      }
    }
  }

  removeClient(id, ws) {
    const s = this.sessions.get(id)
    if (s) s.clients.delete(ws)
  }

  broadcast(id, msg) {
    const s = this.sessions.get(id)
    if (!s) return
    const json = JSON.stringify(msg)
    for (const ws of s.clients) {
      if (ws.readyState === 1) ws.send(json)
    }
  }

  isRunning(id) {
    return this.sessions.has(id)
  }

  getOutput(id) {
    return this.sessions.get(id)?.output || []
  }
}

export const manager = new SessionManager()
