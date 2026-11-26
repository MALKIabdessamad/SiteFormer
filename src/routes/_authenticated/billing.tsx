import { createFileRoute } from '@tanstack/react-router'
import { site } from '~/config/site'
import { BillingScreen } from '~/features/billing'

export const Route = createFileRoute('/_authenticated/billing')({
  head: () => ({ meta: [{ title: `Plans & credits · ${site.name}` }] }),
  component: BillingScreen,
})
