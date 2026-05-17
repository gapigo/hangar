import { spawn } from 'node-pty'
import { EventEmitter } from 'events'
import os from 'os'

class SessionManager extends EventEmitter {
  constructor() {
    super()
    this.sessions = new Map() // id → { pty, clients: Set<WebSocket>, buffer: string[] }
  }

  start(project, promptText) {
    if (this.sessions.has(project.id)) this.stop(project.id)

    const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash'

    // Monta comando baseado no harness
    const cmds = {
      omp: `omp --model ${project.model} --cwd "${project.path}" --new`,
      opencode: `opencode --cwd "${project.path}"`,
      pi: `pi --cwd "${project.path}"`,
    }
    const cmd = cmds[project.harness] || cmds.omp

    const ptyProcess = spawn(shell, ['/c', cmd], {
      name: 'xterm-color',
      cols: 220,
      rows: 50,
      cwd: project.path,
      env: { ...process.env, TERM: 'xterm-color', COLORTERM: 'truecolor' },
    })

    const session = { pty: ptyProcess, clients: new Set(), buffer: [] }
    this.sessions.set(project.id, session)

    // Se tiver prompt inicial, envia após 4s
    if (promptText) {
      setTimeout(() => {
        if (this.sessions.has(project.id)) {
          ptyProcess.write(promptText + '\r')
        }
      }, 4000)
    }

    ptyProcess.onData(data => {
      session.buffer.push(data)
      if (session.buffer.length > 1000) session.buffer.shift()
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', data }))
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(project.id)
      const status = exitCode === 0 ? 'done' : 'paused'
      this.emit('status', project.id, status)
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', exitCode, status }))
      }
    })

    this.emit('status', project.id, 'running')
  }

  stop(id) {
    const s = this.sessions.get(id)
    if (!s) return
    try { s.pty.kill() } catch {}
    this.sessions.delete(id)
    this.emit('status', id, 'idle')
  }

  send(id, data) {
    const s = this.sessions.get(id)
    if (s) s.pty.write(data)
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id)
    if (s) s.pty.resize(cols, rows)
  }

  addClient(id, ws) {
    const s = this.sessions.get(id)
    if (!s) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session not running' }))
      return
    }
    s.clients.add(ws)
    // Envia buffer histórico
    for (const chunk of s.buffer) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'data', data: chunk }))
      }
    }
  }

  removeClient(id, ws) {
    const s = this.sessions.get(id)
    if (s) s.clients.delete(ws)
  }
}

export const manager = new SessionManager()
