/**
 * Dynamically updates the browser tab favicon from the CMS content store.
 *
 * Reads `global.favicon` — when set, injects or updates the `<link rel="icon">`
 * element in `<head>`. When cleared, removes the custom icon so the browser
 * falls back to the default.
 */

import { useEffect } from "react";
import { useContent } from "../content/useContent";

export default function useFavicon() {
  const c = useContent();
  const href = c("global.favicon");

  useEffect(() => {
    if (!href) return;

    // Find an existing dynamic favicon link, or create one.
    let link = document.querySelector<HTMLLinkElement>(
      "link[data-casanova-favicon]",
    );
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("data-casanova-favicon", "1");
      link.setAttribute("rel", "icon");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
  }, [href]);
}
