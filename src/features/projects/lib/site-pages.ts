/**
 * The pages of a user's site, read from the route tree its dev server generates
 * (src/routeTree.gen.ts, TanStack Router file routes).
 */

const routesIn = (source: string, name: string) => {
  const body = new RegExp(`interface ${name}\\s*\\{([^}]*)\\}`).exec(source)?.[1]
  if (body === undefined) return null
  return [...body.matchAll(/^\s*(['"])(\/[^'"]*)\1\s*:/gm)].map((match) => match[2]!)
}

/** Paths the site can navigate to ("/", "/about", "/posts/$id"), sorted, without API routes. */
export function sitePages(routeTree: string): string[] {
  const paths =
    routesIn(routeTree, 'FileRoutesByTo') ?? routesIn(routeTree, 'FileRoutesByFullPath') ?? []
  return [...new Set(paths.filter((path) => !/^\/api(\/|$)/.test(path)))].sort()
}

const isParam = (segment: string) => segment.includes('$')

/** A page with a parameter ("/posts/$id") needs a value before it can be opened. */
export const isDynamicPage = (path: string) => path.split('/').some(isParam)

/** The fixed part of a page's path, before its first parameter ("/posts/$id" → "/posts/"). */
export function pagePrefix(path: string): string {
  const segments = path.split('/').filter(Boolean)
  const at = segments.findIndex(isParam)
  return `/${(at === -1 ? segments : segments.slice(0, at)).map((s) => `${s}/`).join('')}`
}

/** What the user typed in the path box, as a path ("about" → "/about"). */
export const toPath = (input: string) => `/${input.trim().replace(/^\/+/, '')}`
