import { expect, test } from 'bun:test'
import {
  isDynamicPage,
  pagePrefix,
  sitePages,
  toPath,
} from '../../src/features/projects/lib/site-pages'

// The part of a generated src/routeTree.gen.ts the server reads.
const routeTree = `
export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/blog': typeof BlogRouteWithChildren
  '/blog/': typeof BlogIndexRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/pricing': typeof PricingRoute
  '/blog': typeof BlogIndexRoute
  '/blog/$slug': typeof BlogSlugRoute
  '/api/contact': typeof ApiContactRoute
  "/about": typeof AboutRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/_layout': typeof LayoutRoute
}
`

test('lists the navigable pages, sorted, without API routes', () => {
  expect(sitePages(routeTree)).toEqual(['/', '/about', '/blog', '/blog/$slug', '/pricing'])
})

test('falls back to full paths, and to nothing without a route tree', () => {
  const older = routeTree.replace(/export interface FileRoutesByTo[\s\S]*?\n}\n/, '')
  expect(sitePages(older)).toEqual(['/', '/blog', '/blog/'])
  expect(sitePages('')).toEqual([])
})

test('dynamic pages open at their fixed prefix', () => {
  expect(isDynamicPage('/blog/$slug')).toBe(true)
  expect(isDynamicPage('/blog')).toBe(false)
  expect(pagePrefix('/blog/$slug')).toBe('/blog/')
  expect(pagePrefix('/shop/$category/$id')).toBe('/shop/')
  expect(pagePrefix('/$')).toBe('/')
  expect(pagePrefix('/{-$lang}/about')).toBe('/')
})

test('turns typed text into a path', () => {
  expect(toPath(' about ')).toBe('/about')
  expect(toPath('//blog/1')).toBe('/blog/1')
  expect(toPath('')).toBe('/')
})
