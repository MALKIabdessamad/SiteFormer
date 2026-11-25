import { Logo } from '~/components/brand/logo'
import { site } from '~/config/site'

/** Marketing panel on the left of the auth screen (large screens only). */
export function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between border-r bg-sidebar p-12 lg:flex xl:p-16">
      <Logo />
      <div>
        <h2 className="font-display text-5xl leading-[1] font-extrabold tracking-[-0.035em] xl:text-6xl">
          Describe it.
          <br />
          <span className="pr-[0.06em] font-normal text-dim italic">Publish</span> it.
        </h2>
        <p className="mt-5 max-w-md text-dim">
          Tell {site.name} what your business does. It lays out the pages, and you put them live on
          your own domain.
        </p>
        <div className="mt-10 max-w-md space-y-3" aria-hidden>
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-3 text-sm">
            A site for my bakery with a menu and opening hours
          </div>
          <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border bg-ink/[0.03] px-4 py-3 text-sm text-dim">
            <span className="text-signal">✓</span> 4 pages ready · bluebird-bakery.com
          </div>
        </div>
      </div>
      <p className="text-sm text-faint">
        © {new Date().getFullYear()} {site.name}
      </p>
    </aside>
  )
}
