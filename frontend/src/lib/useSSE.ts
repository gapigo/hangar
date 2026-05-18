import { useEffect, useRef, useCallback } from 'react'

type SSEEvent = { type: string; id: string; status: string }
type SSEEventHandler = (data: SSEEvent) => void

export function useSSE(onEvent: SSEEventHandler) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    const es = new EventSource('http://localhost:3333/api/events')

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onEventRef.current(data)
      } catch {}
    }

    es.onerror = () => {
      es.close()
      // Reconnect after 3s exponential backoff
      setTimeout(connect, 3000)
    }

    return es
  }, [])

  useEffect(() => {
    const es = connect()
    return () => es.close()
  }, [connect])
}
