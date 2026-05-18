import {
  LayoutDashboard,
  Terminal,
  Settings,
  Plane,
} from 'lucide-react'

import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: 'Hangar',
    email: 'local@hangar.dev',
    avatar: '',
  },
  teams: [
    {
      name: 'Hangar',
      logo: Plane,
      plan: 'oh-my-pi workspace',
    },
  ],
  navGroups: [
    {
      title: 'Workspace',
      items: [
        {
          title: 'Hangar',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Sessions',
          url: '/sessions',
          icon: Terminal,
        },
        {
          title: 'Settings',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
