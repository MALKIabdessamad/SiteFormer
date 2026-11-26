import type { ReactNode } from 'react'
import {
  BookOpen,
  Brain,
  ClipboardCheck,
  Eye,
  ImagePlus,
  Search,
  Camera,
  CheckCircle2,
  Circle,
  CircleDot,
  FilePen,
  FilePlus,
  FileSearch,
  FileText,
  FolderTree,
  Globe,
  Loader2,
  MousePointerClick,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import { ScreenshotImage } from './screenshot-image'

type Json = Record<string, unknown>

export type ToolStepData = {
  id: string
  name: string
  input: Json
  output: Json | null
  running: boolean
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** One line per tool call, phrased for the user. */
function describe(step: ToolStepData): { icon: ReactNode; label: ReactNode } {
  const i = step.input
  const o = step.output ?? {}
  const icon = (Icon: typeof FileText) => <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
  const path = <span className="font-mono text-[0.92em]">{str(i.path) || '/'}</span>
  switch (step.name) {
    case 'list_files':
      return {
        icon: icon(FolderTree),
        label: <>Listed files {str(i.path) && str(i.path) !== '.' ? <>in {path}</> : null}</>,
      }
    case 'read_file':
      return { icon: icon(FileText), label: <>Read {path}</> }
    case 'search_code':
      return { icon: icon(FileSearch), label: <>Searched for “{str(i.query)}”</> }
    case 'write_file':
      return { icon: icon(FilePlus), label: <>Wrote {path}</> }
    case 'edit_file':
      return { icon: icon(FilePen), label: <>Edited {path}</> }
    case 'delete_path':
      return { icon: icon(Trash2), label: <>Deleted {path}</> }
    case 'move_path':
      return {
        icon: icon(FilePen),
        label: (
          <>
            Moved {str(i.from)} → {str(i.to)}
          </>
        ),
      }
    case 'run_command':
      return {
        icon: icon(SquareTerminal),
        label: (
          <>
            Ran <span className="font-mono text-[0.92em]">{str(i.command).slice(0, 80)}</span>
          </>
        ),
      }
    case 'restart_dev_server':
      return { icon: icon(RefreshCw), label: <>Restarted the preview</> }
    case 'read_dev_logs':
      return { icon: icon(FileText), label: <>Read the preview logs</> }
    case 'check_project':
      return {
        icon: icon(ShieldCheck),
        label: <>Checked the project{o.typecheck ? <> · types {String(o.typecheck)}</> : null}</>,
      }
    case 'screenshot':
      return {
        icon: icon(Camera),
        label: (
          <>
            Screenshot of {path} ({str(i.viewport) || 'desktop'})
          </>
        ),
      }
    case 'inspect_page':
      return { icon: icon(ScanSearch), label: <>Inspected {path}</> }
    case 'interact':
      return { icon: icon(MousePointerClick), label: <>Tested {path} in the browser</> }
    case 'fetch_url': {
      let host = str(i.url)
      try {
        host = new URL(host).host
      } catch {
        /* keep raw */
      }
      return { icon: icon(Globe), label: <>Read {host}</> }
    }
    case 'generate_image':
      return {
        icon: icon(ImagePlus),
        label: (
          <>
            Generated an image
            {o.path ? (
              <>
                {' '}
                · <span className="font-mono text-[0.92em]">{str(o.path)}</span>
              </>
            ) : null}
          </>
        ),
      }
    case 'view_image':
      return { icon: icon(Eye), label: <>Looked at {path}</> }
    case 'reference_screenshot': {
      let host = str(i.url)
      try {
        host = new URL(host).host
      } catch {
        /* keep raw */
      }
      return { icon: icon(Camera), label: <>Reference screenshot of {host}</> }
    }
    case 'audit_page': {
      const issues = Array.isArray(o.accessibility) ? o.accessibility.length : null
      return {
        icon: icon(ClipboardCheck),
        label: (
          <>
            Audited {path}
            {issues !== null ? (
              <>
                {' '}
                ·{' '}
                {issues === 0
                  ? 'no accessibility issues'
                  : `${issues} accessibility issue${issues === 1 ? '' : 's'}`}
              </>
            ) : null}
          </>
        ),
      }
    }
    case 'web_search':
      return { icon: icon(Search), label: <>Searched the web: “{str(i.query)}”</> }
    case 'package_docs':
      return {
        icon: icon(BookOpen),
        label: (
          <>
            Read docs:{' '}
            <span className="font-mono text-[0.92em]">
              {str(i.name)}
              {o.version ? `@${String(o.version)}` : ''}
            </span>
          </>
        ),
      }
    case 'remember':
      return { icon: icon(Brain), label: <>Remembered: {str(i.content)}</> }
    case 'forget_memory':
      return { icon: icon(Brain), label: <>Forgot an outdated memory</> }
    default:
      return { icon: icon(CircleDot), label: <>{step.name.replace(/_/g, ' ')}</> }
  }
}

function failed(step: ToolStepData): string | null {
  const o = step.output
  if (!o || o.skipped === true) return null
  if (typeof o.error === 'string') return o.error
  if (step.name === 'run_command' && typeof o.exitCode === 'number' && o.exitCode !== 0) {
    return `Exited with code ${o.exitCode}`
  }
  if (step.name === 'check_project' && o.typecheck === 'failed') return 'Type errors found'
  return null
}

export function ToolStep({ step }: { step: ToolStepData }) {
  if (step.name === 'update_plan') return <PlanCard steps={step.input.steps} />
  if (step.output?.skipped === true) {
    // The agent asked for something it didn't need (nothing changed / budget used).
    const what: Record<string, string> = {
      generate_image: 'Skipped image generation (limit reached)',
      web_search: 'Skipped a web search (limit reached)',
      view_image: 'Skipped viewing an image (limit reached)',
    }
    return (
      <p
        className="flex items-center gap-2 py-0.5 text-xs text-faint"
        title={str(step.output.reason)}
      >
        <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden />{' '}
        {what[step.name] ?? 'Skipped a repeat screenshot'}
      </p>
    )
  }
  const { icon, label } = describe(step)
  const error = failed(step)
  const shot =
    typeof step.output?.screenshot === 'string'
      ? step.output.screenshot
      : typeof step.output?.image === 'string'
        ? step.output.image
        : null
  const sources =
    step.name === 'web_search' && Array.isArray(step.output?.sources)
      ? (step.output.sources as Array<{ title?: string; url?: string }>).filter((x) =>
          x.url?.startsWith('http'),
        )
      : []
  const browserSteps = Array.isArray(step.output?.steps) ? (step.output.steps as Array<string>) : []
  return (
    <div className="text-xs">
      <div
        className={cn('flex min-w-0 items-center gap-2 py-0.5', error ? 'text-danger' : 'text-dim')}
      >
        <span className="shrink-0">
          {step.running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" aria-label="Working" />
          ) : error ? (
            <XCircle className="h-3.5 w-3.5" aria-label="Failed" />
          ) : (
            icon
          )}
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {error && <p className="mb-1 ml-5.5 line-clamp-2 text-[11px] text-danger/80">{error}</p>}
      {browserSteps.length > 0 && (
        <ul className="mb-1 ml-5.5 space-y-0.5 text-[11px] text-faint">
          {browserSteps.slice(0, 6).map((s, n) => (
            <li key={n}>{s}</li>
          ))}
        </ul>
      )}
      {sources.length > 0 && (
        <ul className="mb-1 ml-5.5 space-y-0.5 text-[11px]">
          {sources.slice(0, 5).map((source) => (
            <li key={source.url} className="truncate">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-signal hover:underline"
              >
                {source.title || source.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {shot && (
        <div className="ml-5.5">
          <ScreenshotImage path={shot} alt={`Screenshot of ${str(step.input.path) || '/'}`} />
        </div>
      )}
    </div>
  )
}

function PlanCard({ steps }: { steps: unknown }) {
  if (!Array.isArray(steps)) return null
  const list = steps as Array<{ title?: string; status?: string }>
  const done = list.filter((s) => s.status === 'done').length
  return (
    <div className="my-1 rounded-xl border bg-ink/[0.03] p-3 text-xs">
      <p className="mb-2 font-semibold text-ink">
        Plan · {done}/{list.length}
      </p>
      <ul className="space-y-1.5">
        {list.map((s, n) => (
          <li
            key={n}
            className={cn(
              'flex items-start gap-2',
              s.status === 'done' ? 'text-faint line-through' : 'text-dim',
            )}
          >
            {s.status === 'done' ? (
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-signal" aria-label="Done" />
            ) : s.status === 'in_progress' ? (
              <Loader2
                className="mt-px h-3.5 w-3.5 shrink-0 animate-spin text-signal"
                aria-label="In progress"
              />
            ) : (
              <Circle className="mt-px h-3.5 w-3.5 shrink-0" aria-label="Pending" />
            )}
            <span className={s.status === 'in_progress' ? 'text-ink' : undefined}>{s.title}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
