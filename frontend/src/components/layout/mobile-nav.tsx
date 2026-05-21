import { useNavigate } from '@tanstack/react-router'
import { LayoutGrid, Terminal, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { icon: LayoutGrid, label: 'Hangar',   to: '/' },
  { icon: Terminal,   label: 'Sessions', to: '/sessions' },
  { icon: Settings,   label: 'Settings', to: '/settings' },
]

export function MobileNav() {
  const navigate = useNavigate()
  const pathname = window.location.pathname

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[60] bg-background border-t flex md:hidden">
      {items.map(({ icon: Icon, label, to }) => {
        const active = pathname === to || (to !== '/' && pathname.startsWith(to))
        return (
          <button
            key={to}
            onClick={() => navigate({ to })}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs transition-colors',
              active
                ? 'text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
