import { Outlet, createFileRoute } from '@tanstack/react-router'
import { requireUser } from '~/features/auth'

/**
 * Layout for pages that need a signed-in user. The session lives in the browser,
 * so everything under it renders on the client only.
 */
export const Route = createFileRoute('/_authenticated')({
  ssr: false,
  beforeLoad: async () => ({ user: await requireUser() }),
  pendingComponent: () => <div className="min-h-dvh bg-sidebar" />,
  component: Outlet,
})
