import { expect, test } from 'bun:test'
import { uploadIdOf, uploadSource } from '../../src/features/agent/lib/upload-ref'

test('round-trips an upload reference', () => {
  const part = { type: 'image', source: uploadSource('3f2a', 'image/png') }
  expect(uploadIdOf(part)).toBe('3f2a')
})

test('ignores anything that is not an upload reference', () => {
  expect(uploadIdOf({ type: 'text', content: 'hi' })).toBeNull()
  expect(
    uploadIdOf({ type: 'image', source: { type: 'url', value: 'https://x.test/a.png' } }),
  ).toBeNull()
  expect(uploadIdOf({ type: 'image', source: { type: 'data', value: 'sf-upload:x' } })).toBeNull()
  expect(uploadIdOf(null)).toBeNull()
})
