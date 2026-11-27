import { useCallback, useEffect, useRef, useState } from 'react'
import { reportClientError } from '~/lib/report-error'
import { checkFile, MAX_ATTACHMENTS, uploadFile, type Upload } from '../lib/attachments'

export type Attachment = {
  key: string
  file: File
  /** Object URL for image previews. */
  preview: string | null
  status: 'pending' | 'uploading' | 'ready' | 'error'
  upload?: Upload
  error?: string
}

/**
 * Files attached to the message being written. With a `projectId` they upload immediately;
 * without one (dashboard, project not created yet) they wait for `uploadAll(projectId)`.
 */
export function useAttachments(projectId?: string) {
  const [items, setItems] = useState<Array<Attachment>>([])
  const [notice, setNotice] = useState('')
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Free preview URLs when items go away.
  useEffect(
    () => () =>
      itemsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview)),
    [],
  )

  const patch = (key: string, change: Partial<Attachment>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)))

  const start = useCallback(async (item: Attachment, target: string): Promise<Upload | null> => {
    patch(item.key, { status: 'uploading', error: undefined })
    try {
      const upload = await uploadFile(target, item.file)
      patch(item.key, { status: 'ready', upload })
      return upload
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.'
      patch(item.key, { status: 'error', error: message })
      reportClientError('upload', message, {
        projectId: target,
        detail: `${item.file.type} ${item.file.size}B`,
      })
      return null
    }
  }, [])

  const add = useCallback(
    (files: Iterable<File>) => {
      setNotice('')
      const incoming: Array<Attachment> = []
      for (const file of files) {
        if (itemsRef.current.length + incoming.length >= MAX_ATTACHMENTS) {
          setNotice(`Attach up to ${MAX_ATTACHMENTS} files per message.`)
          break
        }
        const problem = checkFile(file)
        if (problem) {
          setNotice(problem)
          continue
        }
        incoming.push({
          key: crypto.randomUUID(),
          file,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          status: 'pending',
        })
      }
      if (incoming.length === 0) return
      setItems((list) => [...list, ...incoming])
      if (projectId) incoming.forEach((item) => void start(item, projectId))
    },
    [projectId, start],
  )

  /** A file that is already stored (e.g. a drawing on the preview): ready to send at once. */
  const addUploaded = useCallback((file: File, upload: Upload) => {
    if (itemsRef.current.length >= MAX_ATTACHMENTS) {
      setNotice(`Attach up to ${MAX_ATTACHMENTS} files per message.`)
      return
    }
    setNotice('')
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    setItems((list) => [
      ...list,
      { key: crypto.randomUUID(), file, preview, status: 'ready', upload },
    ])
  }, [])

  const remove = useCallback((key: string) => {
    setItems((list) => {
      const item = list.find((i) => i.key === key)
      if (item?.preview) URL.revokeObjectURL(item.preview)
      return list.filter((i) => i.key !== key)
    })
  }, [])

  const clear = useCallback(() => {
    itemsRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview))
    setItems([])
    setNotice('')
  }, [])

  /** Dashboard: upload everything once the project exists. Returns the uploads that succeeded. */
  const uploadAll = useCallback(
    async (target: string) => {
      const results = await Promise.all(
        itemsRef.current.map((item) =>
          item.upload ? Promise.resolve(item.upload) : start(item, target),
        ),
      )
      return results.filter((u): u is Upload => Boolean(u))
    },
    [start],
  )

  return {
    items,
    notice,
    add,
    addUploaded,
    remove,
    clear,
    uploadAll,
    uploading: items.some((i) => i.status === 'uploading' || (projectId && i.status === 'pending')),
    ready: items.filter((i) => i.status === 'ready' && i.upload).map((i) => i.upload!),
  }
}
