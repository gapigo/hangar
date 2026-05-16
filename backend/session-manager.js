import { spawn } from 'child_process'
import * as pty from 'node-pty'
import { store } from './project-store.js'

const sessions = new Map()

function createShell(project) {
  if (process.platform === 'win32') {
    // Use child_process.spawn on Windows to avoid node-pty ConPTY crash on kill
    const proc = spawn('powershell.exe', ['-NoExit', '-Command', '-'], {
      cwd: project.path,
      env: process.env,
      shell: false,
    })

    // Normalize API to look like node-pty
    const wrapper = {
      write: (data) => proc.stdin.write(data),
      kill: () => { try { proc.kill() } catch {} },
      onData: (cb) => {
        proc.stdout.on('data', cb)
        proc.stderr.on('data', cb)
      },
      onExit: (cb) => {
        proc.on('exit', cb)
        proc.on('error', cb)
      },
    }
    return wrapper
  }

  // Unix: use real node-pty
  const proc = pty.spawn('bash', [], {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: project.path,
    env: process.env,
  })

  return {
    write: (data) => proc.write(data),
    kill: () => proc.kill(),
    onData: (cb) => proc.onData(cb),
    onExit: (cb) => proc.onExit(cb),
  }
}

export const manager = {
  start(project) {
    if (sessions.has(project.id)) return

    const proc = createShell(project)
    const clients = new Set()
    sessions.set(project.id, { proc, clients, project })

    // Send the omp command
    const command = `omp --model ${project.model} --cwd ${project.path} --new\n`
    proc.write(command)

    proc.onData((data) => {
      store.appendOutput(project.id, data.toString())
      clients.forEach((ws) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString() }))
        }
      })
    })

    proc.onExit(() => {
      // Only mark done if session wasn't already removed by stop()
      if (sessions.has(project.id)) {
        store.update(project.id, { status: 'done' })
        clients.forEach((ws) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'status', status: 'done' }))
          }
        })
        sessions.delete(project.id)
      }
    })

    return proc
  },

  stop(id) {
    const session = sessions.get(id)
    if (!session) return
    try {
      session.proc.write('exit\n')
      setTimeout(() => {
        try { session.proc.kill() } catch {}
      }, 500)
    } catch {
      /* ignore kill errors */
    }
    sessions.delete(id)
  },

  addClient(id, ws) {
    const session = sessions.get(id)
    if (session) {
      session.clients.add(ws)
    }
    // Send current project info
    const project = store.get(id)
    if (project && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'project', project }))
    }
  },

  removeClient(id, ws) {
    const session = sessions.get(id)
    if (session) {
      session.clients.delete(ws)
    }
  },

  send(id, data) {
    const session = sessions.get(id)
    if (session && session.proc) {
      session.proc.write(data + '\n')
    }
  },

  getSession(id) {
    return sessions.get(id) || null
  },
}
