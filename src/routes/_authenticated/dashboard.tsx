import { createFileRoute } from '@tanstack/react-router'
import { site } from '~/config/site'
import { DashboardScreen } from '~/features/dashboard'

export const Route = createFileRoute('/_authenticated/dashboard')({
  head: () => ({ meta: [{ title: `Dashboard · ${site.name}` }] }),
  component: DashboardPage,
})

function DashboardPage() {
  const { user } = Route.useRouteContext()
  return <DashboardScreen email={user.email ?? ''} />
}
