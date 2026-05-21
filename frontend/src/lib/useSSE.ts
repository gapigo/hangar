import { useEffect, useRef, useCallback } from 'react'

type SSEEvent = { type: string;[key: string]: unknown }
type SSEEventHandler = (data: SSEEvent) => void

// Dynamic origin for SSE: works on localhost, LAN IP, or Cloudflare tunnel
const SSE_URL = `${window.location.protocol}//${window.location.host}/api/events`

export function useSSE(onEvent: SSEEventHandler) {
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const connect = useCallback(() => {
    const es = new EventSource(SSE_URL)

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
