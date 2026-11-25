/**
 * File tools. Token-conscious: reads are windowed with line numbers, listings and searches are
 * capped, and edits are exact find/replace (the model never rewrites a whole file to change a
 * line).
 */
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { applyMatches, findMatches } from './text-match'
import {
  capText,
  readText,
  relativePath,
  sh,
  shellQuote,
  sitePath,
  ToolError,
  writeText,
  type SandboxSession,
} from '../sandbox-session.server'

const READ_MAX_LINES = 400
const LIST_MAX = 300
const SEARCH_MAX = 80

const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length)

export function fileTools(session: SandboxSession) {
  const listFiles = toolDefinition({
    name: 'list_files',
    description:
      'List project files (respects .gitignore; node_modules excluded). Optionally under a folder.',
    inputSchema: z.object({
      path: z.string().optional().describe('Folder relative to the project root (default ".").'),
    }),
  }).server(async ({ path = '.' }) => {
    const dir = sitePath(path, { allowRoot: true })
    const rel = relativePath(dir)
    const result = await sh(
      session,
      `git ls-files --cached --others --exclude-standard -- ${shellQuote(rel === '.' ? '.' : rel)} | sort`,
      { timeoutSeconds: 30 },
    )
    const files = result.stdout.split('\n').filter(Boolean)
    return {
      count: files.length,
      files: files.slice(0, LIST_MAX),
      ...(files.length > LIST_MAX
        ? { truncated: `${files.length - LIST_MAX} more not shown` }
        : {}),
    }
  })

  const readFile = toolDefinition({
    name: 'read_file',
    description: `Read a text file with line numbers. Returns at most ${READ_MAX_LINES} lines per call; pass startLine to read further.`,
    inputSchema: z.object({
      path: z.string(),
      startLine: z.number().int().min(1).optional().describe('Default 1.'),
      endLine: z.number().int().min(1).optional(),
    }),
  }).server(async ({ path, startLine = 1, endLine }) => {
    const text = await readText(session, sitePath(path))
    const lines = text.split('\n')
    const end = Math.min(
      endLine ?? startLine + READ_MAX_LINES - 1,
      startLine + READ_MAX_LINES - 1,
      lines.length,
    )
    const width = String(end).length
    const body = lines
      .slice(startLine - 1, end)
      .map((line, i) => `${String(startLine + i).padStart(width)}│${line}`)
      .join('\n')
    return {
      path: relativePath(sitePath(path)),
      totalLines: lines.length,
      ...(end < lines.length ? { more: `Lines ${end + 1}-${lines.length} not shown` } : {}),
      content: capText(body, 40_000),
    }
  })

  const searchCode = toolDefinition({
    name: 'search_code',
    description:
      'Search file contents (git grep, respects .gitignore). Fixed string by default; set regex for extended regex.',
    inputSchema: z.object({
      query: z.string().min(1).max(300),
      path: z.string().optional().describe('Folder to search (default ".").'),
      regex: z.boolean().optional(),
      ignoreCase: z.boolean().optional(),
    }),
  }).server(async ({ query, path = '.', regex = false, ignoreCase = false }) => {
    const dir = relativePath(sitePath(path, { allowRoot: true }))
    const flags = `${regex ? '-E' : '-F'}${ignoreCase ? ' -i' : ''}`
    const result = await sh(
      session,
      `git grep -n -I --untracked ${flags} -e ${shellQuote(query)} -- ${shellQuote(dir)} | head -${SEARCH_MAX + 1}`,
      { timeoutSeconds: 30 },
    )
    const matches = result.stdout.split('\n').filter(Boolean)
    return {
      matches: matches.slice(0, SEARCH_MAX).map((m) => capText(m, 300)),
      ...(matches.length > SEARCH_MAX
        ? { truncated: 'More matches exist; narrow the search.' }
        : {}),
    }
  })

  const writeFile = toolDefinition({
    name: 'write_file',
    description:
      'Create a new file or fully replace a small one. For changes to existing files prefer edit_file.',
    inputSchema: z.object({ path: z.string(), content: z.string().max(400_000) }),
  }).server(async ({ path, content }) => {
    const absolute = sitePath(path)
    await writeText(session, absolute, content)
    return { path: relativePath(absolute), lines: lineCount(content) }
  })

  const editFile = toolDefinition({
    name: 'edit_file',
    description:
      'Edit a file by find/replace. Copy oldText exactly from read_file (without the line-number ' +
      'prefix); it must match exactly once (include surrounding lines to be unique) unless ' +
      'replaceAll is true. Edits apply in order; if any fails, nothing is written.',
    inputSchema: z.object({
      path: z.string(),
      edits: z
        .array(
          z.object({
            oldText: z.string().min(1),
            newText: z.string(),
            replaceAll: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(30),
    }),
  }).server(async ({ path, edits }) => {
    const absolute = sitePath(path)
    let text = await readText(session, absolute)
    const fuzzy: Array<string> = []
    for (const [i, edit] of edits.entries()) {
      const result = findMatches(text, edit.oldText, edit.replaceAll ?? false)
      if (!result.ok) {
        const where = relativePath(absolute)
        throw new ToolError(
          result.reason === 'ambiguous'
            ? `Edit ${i + 1}: oldText matches ${result.count} places in ${where}. Include more surrounding lines, or set replaceAll.`
            : `Edit ${i + 1}: oldText not found in ${where}. Copy it exactly from read_file (without the line-number prefix).${result.hint ? ` ${result.hint}` : ''}`,
        )
      }
      const strategy = result.matches[0]!.strategy
      if (strategy !== 'exact') fuzzy.push(`edit ${i + 1} matched ignoring ${strategy}`)
      text = applyMatches(text, result.matches, edit.newText)
    }
    await writeText(session, absolute, text)
    return {
      path: relativePath(absolute),
      editsApplied: edits.length,
      lines: lineCount(text),
      ...(fuzzy.length ? { note: fuzzy.join('; ') } : {}),
    }
  })

  const deletePath = toolDefinition({
    name: 'delete_path',
    description: 'Delete a file or folder inside the project.',
    inputSchema: z.object({ path: z.string() }),
  }).server(async ({ path }) => {
    const absolute = sitePath(path)
    const result = await sh(
      session,
      `test -e ${shellQuote(absolute)} && rm -rf -- ${shellQuote(absolute)} && echo ok`,
      {
        timeoutSeconds: 30,
      },
    )
    if (result.stdout.trim() !== 'ok') throw new ToolError(`Not found: ${relativePath(absolute)}`)
    return { deleted: relativePath(absolute) }
  })

  const movePath = toolDefinition({
    name: 'move_path',
    description: 'Move or rename a file or folder inside the project.',
    inputSchema: z.object({ from: z.string(), to: z.string() }),
  }).server(async ({ from, to }) => {
    const source = sitePath(from)
    const target = sitePath(to)
    const dir = target.slice(0, target.lastIndexOf('/'))
    const result = await sh(
      session,
      `test -e ${shellQuote(source)} || { echo missing; exit 0; }; test -e ${shellQuote(target)} && { echo exists; exit 0; }; mkdir -p ${shellQuote(dir)} && mv -- ${shellQuote(source)} ${shellQuote(target)} && echo ok`,
      { timeoutSeconds: 30 },
    )
    const out = result.stdout.trim()
    if (out === 'missing') throw new ToolError(`Not found: ${relativePath(source)}`)
    if (out === 'exists') throw new ToolError(`Already exists: ${relativePath(target)}`)
    if (out !== 'ok') throw new ToolError('Move failed.')
    return { moved: relativePath(source), to: relativePath(target) }
  })

  return [listFiles, readFile, searchCode, writeFile, editFile, deletePath, movePath]
}
