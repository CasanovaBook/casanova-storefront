export interface MarketingNavLink {
  label: string
  /** Section id on the landing page, without the leading `#`. */
  hash: string
  /** Absolute path so the same link works from every page. */
  href: string
}

/** The landing page's menu is the single source of truth for the site. */
export const MARKETING_NAV_LINKS: MarketingNavLink[] = [
  { label: "על הספר", hash: "about", href: "/#about" },
  { label: "מה בפנים", hash: "inside", href: "/#inside" },
  { label: "רכישה", hash: "purchase", href: "/#purchase" },
  { label: "שאלות נפוצות", hash: "faq", href: "/#faq" },
]
