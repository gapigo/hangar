import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Square, ArrowLeft } from 'lucide-react'
import { useSSE } from '@/lib/useSSE'
import { cn } from '@/lib/utils'
import { api, type Project } from '@/lib/api'
import { ArtifactsPanel } from '@/features/sessions/ArtifactsPanel'
import { useIsMobile } from '@/hooks/use-mobile'
import '@xterm/xterm/css/xterm.css'

const statusColors: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-emerald-500 text-white animate-pulse',
  paused: 'bg-yellow-500 text-black',
  done: 'bg-blue-500 text-white',
}

export function SessionView() {
  const { id } = useParams({ from: '/sessions/$id' })
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [exited, setExited] = useState(false)
  const [exitInfo, setExitInfo] = useState<{ exitCode: number; status: string } | null>(null)
  const [showArtifacts, setShowArtifacts] = useState(() => {
    try {
      return localStorage.getItem('hangar-show-artifacts-' + id) === 'true'
    } catch {
      return false
    }
  })
  const [pendingCount, setPendingCount] = useState(0)
  const isMobile = useIsMobile()
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  // Persist artifact panel toggle
  useEffect(() => {
    try { localStorage.setItem('hangar-show-artifacts-' + id, String(showArtifacts)) } catch {}
  }, [showArtifacts, id])

  useSSE(useCallback((data) => {
    if (data.type === 'comment-added' && data.projectId === id) setPendingCount(c => c + 1)
  }, [id]))

  const refresh = useCallback(() => {
    api.getProjects().then((data: Project[]) => {
      setProjects(data)
      const p = data.find((x) => x.id === id) || null
      if (p) setProject(p)
    })
  }, [id])

  useEffect(() => { refresh() }, [refresh])

  // xterm.js terminal setup
  useEffect(() => {
    if (!termRef.current || terminalRef.current) return

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      theme: {
        background: '#09090b',
        foreground: '#d4d4d8',
        cursor: '#22c55e',
        selectionBackground: '#22c55e33',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#d4d4d8',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
    })

    term.loadAddon(fitAddon)
    term.open(termRef.current)
    // Delay fit to let the container layout settle
    requestAnimationFrame(() => {
      fitAddon.fit()
      requestAnimationFrame(() => fitAddon.fit())
    })
    terminalRef.current = term
    // WebSocket connection
    const wsUrl = `ws://localhost:3333/sessions/${id}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'data') {
          term.write(msg.data)
        } else if (msg.type === 'exit') {
          setExited(true)
          setExitInfo({ exitCode: msg.exitCode, status: msg.status })
          term.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode} — ${msg.status}]\x1b[0m\r\n`)
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`)
        }
      } catch {
        // binary or raw data
        term.write(event.data)
      }
    }

    ws.onclose = () => {
      setExited(true)
    }

    // Input from terminal → WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonRef.current) return
      fitAddonRef.current.fit()
      const dims = fitAddonRef.current.proposeDimensions()
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
      }
    })

    if (termRef.current) {
      resizeObserver.observe(termRef.current)
    }

    // Focus terminal on click
    termRef.current.addEventListener('click', () => term.focus())

    return () => {
      resizeObserver.disconnect()
      term.dispose()
      terminalRef.current = null
      ws.close()
      wsRef.current = null
    }
  }, [id])

  const handleStop = async () => {
    await api.stopProject(id)
    setExited(true)
    refresh()
  }

  const isRunning = project?.status === 'running' && !exited

  // Inject xterm layout fixes on mount
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .xterm { height: 100%; width: 100%; padding: 0; }
      .xterm-viewport { width: 100% !important; }
      .xterm-screen { width: 100% !important; }
    `
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  return (
    <div className='flex h-full'>
      {/* Left sidebar - project switcher */}
      <div className='flex w-[240px] flex-col border-r bg-muted/30'>
        <div className='border-b p-3'>
          <h2 className='text-sm font-semibold'>Sessions</h2>
        </div>
        <ScrollArea className='flex-1'>
          <div className='flex flex-col gap-1 p-2'>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate({ to: '/sessions/$id', params: { id: p.id } })}
                className={`flex flex-col items-start rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  p.id === id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                }`}
              >
                <span className='font-medium'>{p.name}</span>
                <div className='mt-1 flex flex-wrap gap-1'>
                  <Badge className={`text-[10px] ${statusColors[p.status]}`}>
                    {p.id === id && exitInfo ? exitInfo.status : p.status}
                  </Badge>
                  {p.harness && (
                    <Badge variant='outline' className='text-[9px]'>
                      {p.harness}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
            {projects.length === 0 && (
              <div className='px-3 py-4 text-xs text-muted-foreground'>No projects yet.</div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main terminal area */}
      <div className='flex flex-1 flex-col'>
        {/* Header */}
        <div className='flex items-center justify-between border-b bg-muted/20 px-4 py-2'>
          <div className='flex items-center gap-3'>
            <Link to='/' className='text-muted-foreground hover:text-foreground'>
              <ArrowLeft className='h-4 w-4' />
            </Link>
            <h1 className='text-sm font-semibold'>{project?.name || 'Session'}</h1>
            {project?.harness && (
              <Badge variant='outline' className='text-[10px]'>
                {project.harness}
              </Badge>
            )}
            {project?.model && (
              <Badge variant='secondary' className='text-[10px]'>
                {project.model}
              </Badge>
            )}
            <Badge className={`text-[10px] ${statusColors[project?.status || 'idle']}`}>
              {exitInfo ? exitInfo.status : project?.status || 'idle'}
            </Badge>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              variant={showArtifacts ? 'default' : 'outline'}
              size='sm'
              onClick={() => setShowArtifacts(v => !v)}
            >
              Artifacts
              {pendingCount > 0 && (
                <Badge className='ml-1 bg-yellow-400 text-black'>{pendingCount}</Badge>
              )}
            </Button>
            {isRunning && (
              <Button size='sm' variant='destructive' onClick={handleStop}>
                <Square className='mr-1 h-3 w-3' /> Stop
              </Button>
            )}
          </div>
        </div>


        {/* Split container */}
        <div className={cn(
          'flex gap-0 flex-1 overflow-hidden',
          isMobile && 'flex-col'
        )}>
          <div className={cn(
            'flex-1 min-w-0 flex flex-col',
            showArtifacts && !isMobile && 'w-1/2 flex-none'
          )}>
            {/* Terminal container */}
            <div
              ref={termRef}
              className='flex-1 min-h-0'
              style={{ padding: '4px', background: '#09090b' }}
            />
          </div>
          {showArtifacts && (
            <div className={cn(
              'overflow-y-auto border-l border-border',
              isMobile ? 'h-64' : 'w-1/2'
            )}>
              <ArtifactsPanel projectId={id} />
            </div>
          )}
        </div>
    </div>
      </div>
  )
}
