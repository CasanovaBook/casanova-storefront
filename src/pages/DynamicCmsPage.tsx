/**
 * Dynamic CMS page renderer.
 *
 * Fetches a custom page from the `cms_pages` table by slug and renders
 * its Markdown content inside the storefront layout. Used for pages
 * created through Maestro CMS → "עמודים וקטגוריות".
 */

import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"
import { maestro } from "@/maestro"
import Icon from "@/components/icons"
import PageHeader from "@/components/ui/PageHeader"
import Spinner from "@/components/ui/Spinner"
import { Md } from "@/content/render"

interface CmsPage {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string
  cover_image: string
  seo_title: string | null
  seo_description: string | null
  status: string
  created_at: string
  updated_at: string
}

interface LoadedPage {
  slug: string
  page: CmsPage | null
}

/** Only render cover images from a scheme that is safe in an img element. */
function safeImageUrl(url: string | null | undefined): string {
  const value = url?.trim() ?? ""
  return /^(https?:\/\/|\/\/|\/|data:image\/)/i.test(value) ? value : ""
}

export default function DynamicCmsPage() {
  const { slug } = useParams<{ slug: string }>()
  const [loaded, setLoaded] = useState<LoadedPage | null>(null)

  useEffect(() => {
    if (!slug) return

    let active = true

    maestro.cms_pages
      .list({ filter: { slug, status: "ACTIVE" }, limit: 1 })
      .then((res) => {
        if (!active) return
        const rows = (res.data ?? []) as unknown as CmsPage[]
        setLoaded({ slug, page: rows[0] ?? null })
      })
      .catch(() => {
        if (!active) return
        setLoaded({ slug, page: null })
      })

    return () => {
      active = false
    }
  }, [slug])

  // A result belongs to the slug that produced it, so a previous page can
  // never be shown (or a previous 404 kept) after the route slug changes.
  const current = slug && loaded?.slug === slug ? loaded : null
  const page = current?.page ?? null
  const loading = Boolean(slug) && !current
  const notFound = !slug || Boolean(current && !current.page)

  // Update document title and meta description for the CMS page.
  useEffect(() => {
    if (!page) return
    document.title = page.seo_title || page.title

    let meta = document.querySelector('meta[name="description"]')
    if (!meta) {
      meta = document.createElement("meta")
      meta.setAttribute("name", "description")
      document.head.appendChild(meta)
    }
    meta.setAttribute("content", page.seo_description || page.excerpt || "")
  }, [page])

  if (loading) {
    return (
      <div className="app-page app-page--content px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Spinner label="טוען את העמוד…" />
      </div>
    )
  }

  if (notFound || !page) {
    return (
      <div className="app-page app-page--narrow px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <PageHeader
          eyebrow="404"
          title="העמוד לא נמצא"
          description="העמוד שחיפשתם לא קיים או הוסר."
          breadcrumbs={[
            { label: "דף הבית", to: "/" },
            { label: "העמוד לא נמצא" },
          ]}
          actions={
            <Link to="/" className="app-btn">
              <Icon name="home" size={16} />
              חזרה לבית
            </Link>
          }
        />
      </div>
    )
  }

  const coverSrc = safeImageUrl(page.cover_image)
  const updated = new Date(page.updated_at)
  const updatedLabel = Number.isNaN(updated.getTime())
    ? null
    : updated.toLocaleDateString("he-IL")

  return (
    <div className="app-page app-page--content px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <PageHeader
        eyebrow={
          <span dir="ltr" lang="en">
            CASANOVA
          </span>
        }
        title={page.title}
        description={page.excerpt || undefined}
        breadcrumbs={[{ label: "דף הבית", to: "/" }, { label: page.title }]}
      />

      <article className="app-surface overflow-hidden">
        {coverSrc && (
          <div
            className="border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <img
              src={coverSrc}
              alt={page.title}
              className="w-full object-cover"
              style={{ maxHeight: 400 }}
            />
          </div>
        )}

        <div className="app-surface-body">
          {updatedLabel && (
            <div
              className="mb-6 flex flex-wrap items-center gap-2 border-b pb-4 text-xs"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-muted-foreground)",
              }}
            >
              <Icon name="calendar" size={13} />
              <span>
                עודכן לאחרונה:{" "}
                <time dateTime={page.updated_at}>{updatedLabel}</time>
              </span>
            </div>
          )}

          <div
            className="break-words text-[0.98rem] leading-[1.9]"
            style={{ color: "var(--color-foreground)" }}
          >
            <Md text={page.content ?? ""} />
          </div>
        </div>
      </article>
    </div>
  )
}
