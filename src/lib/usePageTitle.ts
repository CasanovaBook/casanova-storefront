import { useEffect } from "react"

/** Sets a route-specific browser title where the screen does not use PageHeader. */
export default function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    const next = `${title} | CASANOVA`

    document.title = next

    return () => {
      if (document.title === next) document.title = previous
    }
  }, [title])
}
