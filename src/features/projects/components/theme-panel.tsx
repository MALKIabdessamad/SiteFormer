import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn } from '~/lib/utils/cn'
import { toErrorMessage } from '~/lib/utils/errors'
import { readTheme, saveTheme } from '../api/visual-edit.functions'
import { HEX, oklchToHex } from '../lib/colors'
import { THEME_COLORS } from '../lib/theme-css'

const RADII = [
  { value: '0', label: 'None' },
  { value: '0.25rem', label: 'S' },
  { value: '0.5rem', label: 'M' },
  { value: '0.75rem', label: 'L' },
  { value: '1rem', label: 'XL' },
  { value: '1.5rem', label: '2XL' },
]

const toHex = (value: string) => oklchToHex(value) ?? (HEX.test(value) ? value.toLowerCase() : null)

type Theme = { colors: Record<string, string>; radius: string | null }

/** The site's theme colors and corners: previewed live in the page, saved to src/styles.css. */
export function ThemePanel({
  projectId,
  disabled,
  onPreview,
  onSaved,
  onClose,
}: {
  projectId: string
  disabled: boolean
  /** Shows values in the page right away (null drops a preview). */
  onPreview: (vars: Record<string, string | null>) => void
  onSaved: () => void
  onClose: () => void
}) {
  const [initial, setInitial] = useState<Theme | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [radius, setRadius] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    readTheme({ data: { projectId } }).then(
      (theme) => {
        const hex: Record<string, string> = {}
        for (const [token, value] of Object.entries(theme.colors)) {
          const color = toHex(value)
          if (color) hex[token] = color
        }
        setInitial({ colors: hex, radius: theme.radius })
        setColors(hex)
        setRadius(theme.radius)
        setState('ready')
      },
      (err: unknown) => {
        setError(toErrorMessage(err))
        setState('ready')
      },
    )
  }, [projectId])

  const changed = initial
    ? Object.keys(colors).filter((token) => colors[token] !== initial.colors[token])
    : []
  const radiusChanged = initial !== null && radius !== initial.radius
  const dirty = changed.length > 0 || radiusChanged

  const cancel = () => {
    const reset: Record<string, string | null> = {}
    for (const token of changed) reset[`--${token}`] = null
    if (radiusChanged) reset['--radius'] = null
    if (Object.keys(reset).length) onPreview(reset)
    onClose()
  }

  const save = async () => {
    setState('saving')
    setError('')
    try {
      const result = await saveTheme({
        data: {
          projectId,
          colors: Object.fromEntries(changed.map((token) => [token, colors[token]!])),
          ...(radiusChanged && radius ? { radius } : {}),
        },
      })
      if (result.status === 'unsupported') setError(result.message)
      else onSaved()
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setState('ready')
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Theme"
      className="pointer-events-auto w-full max-w-[22rem] rise rounded-2xl border bg-raised/95 p-3 shadow-xl backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold">Theme</p>
          <p className="text-xs text-dim">Colors and corners for the whole site.</p>
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label="Close theme"
          className="grid h-7 w-7 place-items-center rounded-full text-faint hover:bg-ink/[0.06] hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {state === 'loading' ? (
        <p className="flex items-center gap-2 py-6 text-xs text-dim">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Reading the theme…
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-0.5">
            {THEME_COLORS.filter(({ token }) => colors[token]).map(({ token, label }) => (
              <label
                key={token}
                className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-ink/[0.04]"
              >
                <span
                  className="relative block h-6 w-6 shrink-0 rounded-full ring-1 ring-white/20"
                  style={{ background: colors[token] }}
                >
                  <input
                    type="color"
                    value={colors[token]}
                    disabled={disabled}
                    onChange={(e) => {
                      setColors((all) => ({ ...all, [token]: e.target.value }))
                      onPreview({ [`--${token}`]: e.target.value })
                    }}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label={label}
                  />
                </span>
                <span className="min-w-0 truncate text-xs">{label}</span>
              </label>
            ))}
          </div>
          {radius !== null && (
            <div className="mt-2 px-1">
              <p className="text-xs text-dim">Corners</p>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {RADII.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    aria-pressed={radius === option.value}
                    onClick={() => {
                      setRadius(option.value)
                      onPreview({ '--radius': option.value })
                    }}
                    className={cn(
                      'h-7 rounded-full px-2.5 text-xs transition-colors',
                      radius === option.value
                        ? 'bg-signal/15 text-signal'
                        : 'text-dim hover:bg-ink/[0.06] hover:text-ink',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 px-1 text-xs text-dim">{error}</p>}
      {disabled && state !== 'loading' && (
        <p className="mt-2 px-1 text-xs text-dim">The agent is working: save when it’s done.</p>
      )}

      <div className="mt-3 flex justify-end gap-1">
        <button
          type="button"
          onClick={cancel}
          className="h-8 rounded-full px-3 text-xs font-medium text-dim hover:bg-ink/[0.06] hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!dirty || disabled || state !== 'ready'}
          onClick={() => void save()}
          className="inline-flex h-8 btn-sculpted items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === 'saving' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          Save theme
        </button>
      </div>
    </div>
  )
}
