import { expect, test } from 'bun:test'
import { serialQueue } from '../../src/lib/server/serial'

test('work under one key runs one at a time, in order, even after a failure', async () => {
  const serial = serialQueue()
  let file = 'a'
  const edit = (from: string, to: string) =>
    serial('page.tsx', async () => {
      const read = file
      await new Promise((resolve) => setTimeout(resolve, 5)) // a slow round trip
      file = read.replace(from, to)
    })
  const failing = serial('page.tsx', () => Promise.reject(new Error('boom')))
  await Promise.all([edit('a', 'ab'), failing.catch(() => undefined), edit('b', 'bc')])
  expect(file).toBe('abc') // without the queue, the second edit would drop the first
  await expect(failing).rejects.toThrow('boom')
})

test('different keys do not wait for each other', async () => {
  const serial = serialQueue()
  const order: Array<string> = []
  await Promise.all([
    serial('a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('a')
    }),
    serial('b', async () => {
      order.push('b')
    }),
  ])
  expect(order).toEqual(['b', 'a'])
})
