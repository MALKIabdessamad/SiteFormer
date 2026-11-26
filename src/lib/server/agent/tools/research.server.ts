/**
 * web_search (OpenRouter web plugin, paid, budgeted) and package_docs (README + exported API of
 * the INSTALLED version, from node_modules; unpkg if not installed).
 */
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { serverEnv } from '../../env.server'
import { SEARCH_TOKENS, TOKENS_PER_CREDIT } from '~/features/billing/lib/credits'
import { chargeTokens } from '../../billing/credits.server'
import { log } from '../../log.server'
import { capText, sh, shellQuote, ToolError, type SandboxSession } from '../sandbox-session.server'

const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

type Section = { heading: string; body: string }

/** Splits Markdown into sections by heading. */
function sections(markdown: string): Array<Section> {
  const out: Array<Section> = []
  let current: Section = { heading: '(intro)', body: '' }
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence
    const heading = !inFence && /^(#{1,4})\s+(.+)/.exec(line)
    if (heading) {
      if (current.body.trim() || current.heading !== '(intro)') out.push(current)
      current = { heading: heading[2]!.trim(), body: '' }
    } else {
      current.body += `${line}\n`
    }
  }
  out.push(current)
  return out
}

function parsePackageJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Exported names from a .d.ts entry file. */
function exportedNames(dts: string): Array<string> {
  const names = new Set<string>()
  for (const m of dts.matchAll(
    /export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(function|const|class|interface|type|enum|namespace|let)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(`${m[2]} (${m[1]})`)
  }
  for (const m of dts.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return [...names].slice(0, 120)
}

export function researchTools(session: SandboxSession) {
  const webSearch = toolDefinition({
    name: 'web_search',
    description:
      "Search the web (paid, limited per run). Use ONLY for facts you can't know: current docs " +
      'or APIs of a library/service the user mentions, a specific error message, or info the ' +
      'user asks you to look up. Not for things you already know, not for design ideas. For ' +
      'npm packages prefer package_docs; for a URL the user gave use fetch_url.',
    inputSchema: z.object({
      query: z.string().min(3).max(300),
      maxResults: z.number().int().min(1).max(5).optional().describe('Default 4.'),
    }),
  }).server(async ({ query, maxResults = 4 }) => {
    const env = serverEnv()
    if (session.usage.webSearches >= env.SEARCH_MAX_PER_RUN) {
      return {
        skipped: true,
        reason:
          env.SEARCH_MAX_PER_RUN === 0
            ? 'Web search is disabled.'
            : `Search budget for this run (${env.SEARCH_MAX_PER_RUN}) is used up. Use fetch_url on a known URL.`,
      }
    }
    if ((await chargeTokens(session.runId, 0)) * TOKENS_PER_CREDIT < SEARCH_TOKENS) {
      return { skipped: true, reason: 'Not enough credits left for a web search.' }
    }
    session.usage.webSearches += 1
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.any([session.signal, AbortSignal.timeout(45_000)]),
      body: JSON.stringify({
        model: env.SEARCH_MODEL,
        plugins: [{ id: 'web', max_results: maxResults }],
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              'Answer concisely and factually for a web developer, citing sources. Prefer official ' +
              'documentation. Include exact API names, versions and short code only when relevant.',
          },
          { role: 'user', content: query },
        ],
      }),
    }).catch((error: unknown) => {
      throw new ToolError(
        `Search failed: ${error instanceof Error ? error.message : 'network error'}`,
      )
    })
    const data = (await response.json().catch(() => ({}))) as {
      choices?: Array<{
        message?: {
          content?: string
          annotations?: Array<{ url_citation?: { url?: string; title?: string } }>
        }
      }>
      usage?: { cost?: number }
      error?: { message?: string }
    }
    if (!response.ok)
      throw new ToolError(`Search failed: ${data.error?.message ?? response.status}`)
    const message = data.choices?.[0]?.message
    const sources = (message?.annotations ?? [])
      .map((a) => ({
        title: a.url_citation?.title?.slice(0, 120) ?? '',
        url: a.url_citation?.url ?? '',
      }))
      .filter((s) => /^https?:\/\//.test(s.url))
      .filter((s, i, all) => all.findIndex((x) => x.url === s.url) === i)
      .slice(0, maxResults)
    await chargeTokens(session.runId, SEARCH_TOKENS)
    log.info('Web search', {
      event: 'search.done',
      runId: session.runId,
      projectId: session.projectId,
      query: query.slice(0, 120),
      sources: sources.length,
      costUsd: data.usage?.cost,
    })
    return { answer: capText(message?.content ?? '', 2500), sources }
  })

  const packageDocs = toolDefinition({
    name: 'package_docs',
    description:
      'Docs for an npm package as used in THIS project: installed version, exported API names and ' +
      'README (only the sections matching `query`, if given). Use before using a package API ' +
      'you are not sure about, so you never guess signatures. Free.',
    inputSchema: z.object({
      name: z.string().min(1).max(214).describe('npm package name, e.g. "@tanstack/react-router".'),
      query: z
        .string()
        .max(200)
        .optional()
        .describe('What you need, e.g. "path params", "useForm resolver".'),
    }),
  }).server(async ({ name, query }) => {
    if (!NPM_NAME.test(name)) throw new ToolError('Invalid npm package name.')
    const dir = `node_modules/${name}`
    const SEP = '\n@@SF-SEP@@\n'
    const script = [
      `if [ -f ${shellQuote(`${dir}/package.json`)} ]; then`,
      `  echo installed; cat ${shellQuote(`${dir}/package.json`)}; printf '${SEP}'`,
      `  r=$(ls ${shellQuote(dir)} | grep -i '^readme' | head -1); [ -n "$r" ] && head -c 200000 ${shellQuote(dir)}/"$r"; printf '${SEP}'`,
      `  t=$(node -e 'const p=require("./${dir}/package.json"); const e=p.types||p.typings||(p.exports&&p.exports["."]&&(p.exports["."].types||(p.exports["."].import&&p.exports["."].import.types)))||"index.d.ts"; process.stdout.write(String(e))' 2>/dev/null)`,
      `  [ -f ${shellQuote(dir)}/"$t" ] && head -c 120000 ${shellQuote(dir)}/"$t"`,
      `else`,
      `  echo registry; curl -sfL --max-time 20 ${shellQuote(`https://unpkg.com/${name}/package.json`)}; printf '${SEP}'`,
      `  curl -sfL --max-time 20 ${shellQuote(`https://unpkg.com/${name}/README.md`)} | head -c 200000; printf '${SEP}'`,
      `fi`,
    ].join('\n')
    const result = await sh(session, script, { timeoutSeconds: 60 })
    const [head = '', readme = '', dts = ''] = result.stdout
      .split(SEP.trim())
      .map((part) => part.replace(/^\n|\n$/g, ''))
    const source = head.startsWith('installed')
      ? 'node_modules (installed)'
      : 'unpkg (not installed in this project)'
    const pkg = parsePackageJson(head.replace(/^(installed|registry)\n/, ''))
    if (!pkg) throw new ToolError(`Package "${name}" not found (not installed, and not on npm).`)
    const all = sections(readme)
    let docs: string
    if (query?.trim()) {
      const terms = query
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 2)
      const scored = all
        .map((s) => {
          const hay = `${s.heading}\n${s.body}`.toLowerCase()
          const score = terms.reduce(
            (sum, t) =>
              sum + (s.heading.toLowerCase().includes(t) ? 5 : 0) + (hay.split(t).length - 1),
            0,
          )
          return { s, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
      docs = scored.length
        ? scored.map(({ s }) => `## ${s.heading}\n${s.body.trim()}`).join('\n\n')
        : `(No README section matched "${query}".)`
    } else {
      docs = all
        .slice(0, 3)
        .map((s) => `## ${s.heading}\n${s.body.trim()}`)
        .join('\n\n')
    }
    return {
      name,
      version: pkg.version,
      source,
      description: typeof pkg.description === 'string' ? pkg.description.slice(0, 300) : undefined,
      homepage: pkg.homepage,
      sections: all
        .map((s) => s.heading)
        .filter((h) => h !== '(intro)')
        .slice(0, 60),
      ...(dts ? { exports: exportedNames(dts) } : {}),
      docs: capText(docs, 7000),
    }
  })

  return [webSearch, packageDocs]
}
