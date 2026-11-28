import { expect, test } from 'bun:test'
import { parseBridgeEvent } from '../../src/features/projects/lib/preview-bridge'
import { isValidStoredImagePath } from '../../src/lib/server/agent/stored-images'

const PROJECT = '06215d58-4770-47f0-9c5e-58f338bbd74f'
const OTHER = '7ac964e7-0000-4000-8000-000000000000'

test('stored images: only well-formed paths of this project', () => {
  const run = 'run_0123456789abcdef'
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/${run}/1764300000000-1.jpg`)).toBe(true)
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/${run}/gen-1764300000000.webp`)).toBe(true)
  // ".." would be resolved by the storage URL into another project's folder.
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/../${OTHER}/${run}/1-1.jpg`)).toBe(false)
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/${run}/../../${OTHER}/x.jpg`)).toBe(false)
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/..%2F${OTHER}/1-1.jpg`)).toBe(false)
  expect(isValidStoredImagePath(PROJECT, `${OTHER}/${run}/1-1.jpg`)).toBe(false)
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/${run}/notes.txt`)).toBe(false)
  expect(isValidStoredImagePath(PROJECT, `${PROJECT}/${run}/a/b.jpg`)).toBe(false)
})

test('preview bridge: paths stay on the preview site', () => {
  const location = (path: unknown) => parseBridgeEvent({ sf: 1, type: 'location', path })
  expect(location('/about?x=1#top')).toEqual({ type: 'location', path: '/about?x=1#top' })
  expect(location('/')).toEqual({ type: 'location', path: '/' })
  // Another site, however it's spelled.
  expect(location('//evil.example/login')).toBeNull()
  expect(location('/\\evil.example/login')).toBeNull()
  expect(location('https://evil.example/')).toBeNull()
  expect(location('javascript:alert(1)')).toBeNull()
  expect(location('about')).toBeNull()

  const element = { loc: 'src/routes/index.tsx:4:7', tag: 'h1', text: 'Hi', path: '//evil.example' }
  expect(parseBridgeEvent({ sf: 1, type: 'pick', n: 1, element })).toBeNull()
  expect(
    parseBridgeEvent({ sf: 1, type: 'viewport', scrollX: 0, scrollY: 0, path: '//evil.example' }),
  ).toBeNull()
  // An error still shows (on the home page) when its path is not usable.
  expect(
    parseBridgeEvent({ sf: 1, type: 'error', message: 'Boom', path: '//evil.example' }),
  ).toMatchObject({ type: 'error', message: 'Boom', path: '/' })
})
