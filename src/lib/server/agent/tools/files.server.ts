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
    description: `Read a text file. Each line is shown as "<number>│<text>"; the text after │ is the exact file content. At most ${READ_MAX_LINES} lines per call; pass startLine/endLine to read a range.`,
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
    const rel = relativePath(sitePath(path))
    session.readPaths.add(rel)
    // Plain text, not JSON: inside a JSON result every quote would arrive escaped (\"), and
    // models then mangle quotes when copying lines into edit_file.
    const more = end < lines.length ? ` (lines ${end + 1}-${lines.length} not shown)` : ''
    return `${rel} · lines ${startLine}-${end} of ${lines.length}${more}\n${capText(body, 40_000)}`
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
    if (matches.length === 0) return 'No matches.'
    // Plain text "path:line:content" (see read_file for why not JSON).
    return (
      matches
        .slice(0, SEARCH_MAX)
        .map((m) => capText(m, 300))
        .join('\n') +
      (matches.length > SEARCH_MAX ? '\n(More matches exist; narrow the search.)' : '')
    )
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

  // Flat string arguments on purpose: some models drop quotes and newlines in strings nested
  // inside arrays of objects (an `edits: [...]` list arrived as `from ../x;|import …`), while
  // top-level strings (like run_command's command) come through intact. One edit per call;
  // call it several times (in parallel) for several edits.
  const editFile = toolDefinition({
    name: 'edit_file',
    description:
      'Replace one exact piece of a file. read_file the lines first (in this run), then copy ' +
      'oldText character for character from the text after "│" (same quotes and line breaks). ' +
      'It must match exactly once (include a surrounding line to be unique) unless replaceAll ' +
      'is true. For several changes, call edit_file several times. Never edit files with ' +
      'scripts in run_command.',
    inputSchema: z.object({
      path: z.string(),
      oldText: z.string().min(1).describe('Exact current text, copied from read_file.'),
      newText: z.string().describe('The replacement text.'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence.'),
    }),
  }).server(async ({ path, oldText, newText: rawNewText, replaceAll = false }) => {
    const absolute = sitePath(path)
    const where = relativePath(absolute)
    const text = await readText(session, absolute)
    // Leftover JSON escaping in newText (\" instead of "): undo it, unless the file itself
    // uses \" somewhere (then it may be intended).
    const newText = /\\["']/.test(text) ? rawNewText : rawNewText.replace(/\\(["'])/g, '$1')
    // The same insertion sent twice (e.g. two identical parallel calls) must not apply twice.
    if (oldText !== newText && newText.includes(oldText) && text.includes(newText)) {
      return {
        path: where,
        editsApplied: 0,
        note: 'Already applied: the file already has newText.',
      }
    }
    const result = findMatches(text, oldText, replaceAll)
    if (!result.ok) {
      const advice = session.readPaths.has(where)
        ? 'Copy oldText exactly from the text after "│" in read_file (keep the file\'s quotes and line breaks).'
        : `You have not read ${where} in this run: your oldText is probably from an older version. read_file it first.`
      throw new ToolError(
        result.reason === 'ambiguous'
          ? `oldText matches ${result.count} places in ${where}. Include a surrounding line, or set replaceAll.`
          : `oldText not found in ${where}.${result.hint ? ` ${result.hint}` : ''} ${advice}`,
      )
    }
    const strategy = result.matches[0]!.strategy
    const updated = applyMatches(text, result.matches, result.newText?.(newText) ?? newText)
    await writeText(session, absolute, updated)
    return {
      path: where,
      editsApplied: result.matches.length,
      lines: lineCount(updated),
      ...(strategy !== 'exact' ? { note: `matched ignoring ${strategy}` } : {}),
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
    session.workspaceVersion += 1
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
    session.workspaceVersion += 1
    return { moved: relativePath(source), to: relativePath(target) }
  })

  return [listFiles, readFile, searchCode, writeFile, editFile, deletePath, movePath]
}
