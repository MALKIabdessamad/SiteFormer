import { Alert } from '~/components/ui/alert'

export function FormMessages({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
    </>
  )
}
