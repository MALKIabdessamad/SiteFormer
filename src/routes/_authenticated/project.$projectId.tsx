import { createFileRoute } from '@tanstack/react-router'
import { site } from '~/config/site'
import { ProjectScreen } from '~/features/projects'

export const Route = createFileRoute('/_authenticated/project/$projectId')({
  head: () => ({ meta: [{ title: `Project · ${site.name}` }] }),
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  // Remount per project so local UI state (tabs, pending actions) never leaks between projects.
  return <ProjectScreen key={projectId} projectId={projectId} />
}
