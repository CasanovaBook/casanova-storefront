/**
 * Dynamic CMS page renderer.
 *
 * Fetches a custom page from the `cms_pages` table by slug and renders
 * its Markdown content inside the storefront layout. Used for pages
 * created through Maestro CMS → "עמודים וקטגוריות".
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { maestro } from "@/maestro";
import type { GenericRecord } from "@/maestro/connectors/MaestroConnector";
import Icon from "@/components/icons";

interface CmsPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  cover_image: string;
  seo_title: string | null;
  seo_description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Lightweight Markdown → HTML (matches the editor preview). */
function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--color-primary)">$1</a>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:12px;margin:12px 0" />')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[hulo])(.+)$/gm, (m) => (m.startsWith("<") ? m : `<p>${m}</p>`));
}

export default function DynamicCmsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<CmsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    maestro.cms_pages
      .list({ filter: { slug, status: "ACTIVE" }, limit: 1 })
      .then((res) => {
        const rows = (res.data ?? []) as unknown as CmsPage[];
        if (rows.length) {
          setPage(rows[0]);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const html = useMemo(() => (page ? renderMarkdown(page.content) : ""), [page]);

  // Update document title
  useEffect(() => {
    if (page) {
      document.title = page.seo_title || page.title;
      // Update meta description
      let meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "description");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", page.seo_description || page.excerpt || "");
    }
  }, [page]);

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center" style={{ color: "var(--color-muted-foreground)" }}>
        <span className="w-6 h-6 rounded-full border-2 animate-spin"
          style={{ borderColor: "var(--color-border)", borderTopColor: "var(--color-primary)" }} />
        <span className="ms-3 text-sm">טוען…</span>
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 text-center" dir="rtl">
        <Icon name="inbox" size={40} />
        <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>העמוד לא נמצא</h1>
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          העמוד שחיפשתם לא קיים או הוסר.
        </p>
        <a href="/" className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--color-primary)", color: "#000" }}>
          חזרה לבית
        </a>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl px-4 py-10" dir="rtl">
      {/* Cover image */}
      {page.cover_image && (
        <div className="mb-8 overflow-hidden rounded-2xl" style={{ border: "1px solid var(--color-border)" }}>
          <img src={page.cover_image} alt={page.title} className="w-full object-cover" style={{ maxHeight: 400 }} />
        </div>
      )}

      {/* Title */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl" style={{ color: "var(--color-foreground)" }}>
          {page.title}
        </h1>
        {page.excerpt && (
          <p className="mt-3 text-lg leading-relaxed" style={{ color: "var(--color-muted-foreground)" }}>
            {page.excerpt}
          </p>
        )}
        <div className="mt-4 flex items-center gap-3 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
          <span className="flex items-center gap-1">
            <Icon name="calendar" size={12} />
            {new Date(page.updated_at).toLocaleDateString("he-IL")}
          </span>
        </div>
      </header>

      {/* Content */}
      <div
        className="cms-page-content text-base leading-relaxed"
        style={{ color: "var(--color-foreground)" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
