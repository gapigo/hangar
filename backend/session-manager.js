import { spawn } from 'node-pty'
import { ArtifactParser } from './artifact-parser.js'
import { EventEmitter } from 'events'
import os from 'os'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

const isWindows = os.platform() === 'win32'

// Path to omp's bun-based CLI entry point
const OMP_CLI_PATH = join(homedir(), 'node_modules', '@oh-my-pi', 'pi-coding-agent', 'src', 'cli.ts')

// On Windows CreateProcess resolves .exe via PATH; fallback to full path
const BUN_CMD = isWindows
  ? join(homedir(), '.bun', 'bin', 'bun.exe')
  : 'bun'

class SessionManager extends EventEmitter {
  constructor() {
    super()
    this.sessions = new Map() // id → { pty, clients: Set<WebSocket>, buffer: string[] }
  }
  getSession(id) { return this.sessions.get(id) }

  start(project, promptText) {
    if (this.sessions.has(project.id)) this.stop(project.id)

    // Ensure project directory exists
    if (!existsSync(project.path)) {
      mkdirSync(project.path, { recursive: true })
    }

    let ptyProcess

    if (project.harness === 'omp') {
      // omp usa bun + cli.ts — no Windows, o wrapper shell script não funciona com cmd.exe
      const bunExe = BUN_CMD
      const cliPath = OMP_CLI_PATH
      const args = [
        cliPath,
        '--model', project.model,
        '--cwd', project.path,
        '--new',
      ]
      ptyProcess = spawn(bunExe, args, this._ptyOptions(project))
    } else if (project.harness === 'opencode') {
      ptyProcess = this._spawnShell(`opencode --cwd "${project.path}"`, project)
    } else if (project.harness === 'pi') {
      ptyProcess = this._spawnShell(`pi --cwd "${project.path}"`, project)
    } else {
      ptyProcess = this._spawnShell(`${project.harness}`, project)
    }

    const session = { pty: ptyProcess, clients: new Set(), buffer: [] }
  const parser = new ArtifactParser(
    project.id,
    (artifact) => this.emit('artifact', project.id, artifact),
    (artifactId, artifact) => this.emit('artifact-update', project.id, artifactId, artifact)
  )
  session.parser = parser
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
      session.parser.push(data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.delete(project.id)
      const status = exitCode === 0 ? 'done' : 'paused'
      session.parser.flush()
      this.emit('status', project.id, status)
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', exitCode, status }))
      }
    })

    this.emit('status', project.id, 'running')
  }

  _ptyOptions(project) {
    return {
      name: 'xterm-color',
      cols: 100,
      rows: 30,
      cwd: project.path,
      env: { ...process.env, TERM: 'xterm-color', COLORTERM: 'truecolor' },
    }
  }

  _spawnShell(cmd, project) {
    if (isWindows) {
      return spawn('cmd.exe', ['/c', cmd], this._ptyOptions(project))
    }
    return spawn('bash', ['-c', cmd], this._ptyOptions(project))
  }

  stop(id) {
    const s = this.sessions.get(id)
    if (!s) return
    try { s.pty.kill() } catch {}
    if (s.parser) s.parser.flush()
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
