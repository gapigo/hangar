import { useNavigate } from '@tanstack/react-router'
import { LayoutGrid, Terminal, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { icon: LayoutGrid, label: 'Hangar',   to: '/' },
  { icon: Terminal,   label: 'Sessions', to: '/sessions' },
  { icon: Settings,   label: 'Settings', to: '/settings' },
] as const

export function MobileNav() {
  const navigate = useNavigate()
  const path = window.location.pathname

  return (
    <nav
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="fixed bottom-0 left-0 right-0 z-[100] bg-background border-t border-border flex md:hidden w-full"
    >
      {NAV_ITEMS.map(({ icon: Icon, label, to }) => {
        const active = to === '/'
          ? path === '/'
          : path.startsWith(to)
        return (
          <button
            key={to}
            onClick={() => navigate({ to })}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-w-0',
              active
                ? 'text-primary'
                : 'text-muted-foreground'
            )}
          >
            <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
