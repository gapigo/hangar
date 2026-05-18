import { useEffect, useRef, useState, useCallback } from 'react'

type WSStatus = 'connecting' | 'open' | 'closed'

export type WSMessage =
  | { type: 'output'; text: string }
  | { type: 'exit'; code: number; status: string }
  | { type: 'error'; message: string }

export function useWebSocket(sessionId: string) {
  const [messages, setMessages] = useState<WSMessage[]>([])
  const [status, setStatus] = useState<WSStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(2000)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const wsUrl = `ws://localhost:3333/sessions/${sessionId}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => {
      setStatus('open')
      backoffRef.current = 2000
    }

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data)
        setMessages((prev) => [...prev, parsed])
      } catch {
        setMessages((prev) => [...prev, { type: 'output', text: event.data }])
      }
    }

    ws.onclose = () => {
      setStatus('closed')
      wsRef.current = null
      const delay = Math.min(backoffRef.current, 30000)
      backoffRef.current = backoffRef.current * 1.5
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [sessionId])

  const sendMessage = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(text)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { messages, sendMessage, status }
}
