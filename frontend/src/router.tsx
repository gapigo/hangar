import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'
import { KanbanView } from '@/features/kanban'
import { SessionView } from '@/features/sessions'
import { SessionsHub } from '@/features/sessions/hub'
import { SettingsView } from '@/features/settings'

const queryClient = new QueryClient()

const rootRoute = createRootRoute({
  component: () => (
    <AuthenticatedLayout>
      <NavigationProgress />
      <Outlet />
      <Toaster duration={5000} />
    </AuthenticatedLayout>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: KanbanView,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
})

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: SessionsHub,
})

const sessionIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$id',
  component: SessionView,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  sessionsRoute,
  sessionIdRoute,
])

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
