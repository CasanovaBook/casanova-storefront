import { useEffect, useLayoutEffect } from "react"
import { useLocation } from "react-router"

/**
 * Resets the document to the top whenever the route's path changes.
 *
 * Legal and informational pages are often opened from a footer at the very
 * bottom of the previous page. Without this, the browser keeps that scroll
 * offset and the new page appears to start halfway down. The reset is
 * deliberately synchronous (a layout effect) so the old offset is never
 * painted on the new route.
 *
 * Hash navigation is left alone: skip links and the landing page's section
 * links need the browser to keep their own scroll target. Browser scroll
 * restoration is turned off because it can otherwise put a back/forward
 * navigation back at the previous page's offset after this reset.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = "manual"
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  useLayoutEffect(() => {
    if (hash) return
    window.scrollTo(0, 0)
  }, [pathname, hash])

  return null
}
