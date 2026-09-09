import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

import siteConfiguration from "./.figma/make/site.json"

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  // .figma/make/deploy-preview passes `--mode development` for cached-preview builds.
  const emitSourcemaps = mode === "development"
  // `mode` cannot separate dev from build here, because deploy-preview builds
  // in development mode, so the split comes from `command` instead.
  const isDevServer = command === "serve"

  return {
    base: process.env.FIGMA_PUBLIC_URL
      ? `${process.env.FIGMA_PUBLIC_URL}/`
      : "/",
    build: {
      sourcemap: emitSourcemaps ? "inline" : false,
      minify: !emitSourcemaps,
      rollupOptions: {
        output: {
          /* React and the router move on a completely different schedule from
           * application code, so keeping them in their own chunks means editing
           * a page does not invalidate the vendor bytes a returning reader
           * already has cached. Route-level `lazy()` splits the pages.
           *
           * Rolldown, which Vite 8 builds on, only accepts the function form
           * of manualChunks — the object form is rejected at build time. */
          manualChunks(id) {
            if (!id.includes("node_modules")) return
            if (id.includes("react-router")) return "router"
            /* The trailing separator keeps `react` from also swallowing
             * react-router; scheduler is the reconciler react-dom pulls in. */
            if (
              /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)
            )
              return "react"
          },
        },
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      figmaContentSecurityPolicy(isDevServer),
      figmaSiteConfiguration(siteConfiguration),
      figmaErrorOverlayReplay(),
      figmaReactRefreshBoundaryFallback(),
      figmaMakeKitPlugin({ storiesGlob: "/src/**/*.stories.{ts,tsx,js,jsx}" }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: parseInt(process.env.PORT || "8443"),
      strictPort: true,
      /* Ignore heavy/locked binary content — watching docs/*.pdf crashed the
       * server with EBUSY.
       *
       * PDFs are now ignored by directory instead of by extension. The blanket
       * extension glob also covered public/books, and that broke the one thing
       * this storefront exists to do: Vite builds its list of servable public-dir
       * files at startup and refreshes it from watcher events, so a title dropped
       * into public/books while the server was running was never seen. The request
       * fell through to the SPA fallback, and the reader's <iframe> was handed
       * index.html with a 200 and Content-Type text/html instead of the book —
       * a blank viewer, no error in the console, and a restart that appeared to
       * fix it. Keeping public/books watched removes that trap; docs/ keeps its
       * directory-level ignore, which is where the EBUSY actually came from.
       *
       * react-native/ is a separate project sharing this repository; the web
       * server has no reason to stat Android and iOS build artefacts. */
      watch: {
        ignored: [
          "**/.figma/**",
          "**/docs/**",
          "**/images/**",
          "**/dist/**",
          "**/react-native/**",
        ],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: parseInt(process.env.PORT || "8443"),
    },
  }
})

type FigmaSiteConfiguration = {
  title?: string
  description?: string
  language?: string
  robots?: {
    index?: boolean
  }
  icons?: {
    icon?: string
  }
  openGraph?: {
    image?: string
  }
  analytics?: {
    googleAnalyticsId?: string
  }
  customScripts?: {
    headStart?: string
    headEnd?: string
    bodyStart?: string
    bodyEnd?: string
  }
  accessibility?: {
    addBypassLinks?: boolean
  }
}

/** Applies /.figma/make/site.json to the generated document shell. */
function figmaSiteConfiguration(config: FigmaSiteConfiguration): Plugin {
  function sanitizeHtmlValue(value: string | undefined): string {
    return value?.replace(/[^a-zA-Z0-9_-]/g, "") || ""
  }
  function escapeHtmlText(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  }
  function replaceHtmlCommentSlot(
    html: string,
    slotName: string,
    content: string,
  ): string {
    return html.replace(`<!-- ${slotName} -->`, content)
  }

  const title = config.title ?? "Figma Make App"
  const description = config.description ?? ""
  const favicon = config.icons?.icon ?? ""
  const socialImage = config.openGraph?.image ?? ""
  const language = sanitizeHtmlValue(config.language) || "en"
  const googleAnalyticsId = sanitizeHtmlValue(
    config.analytics?.googleAnalyticsId,
  )
  const headStart = config.customScripts?.headStart ?? ""
  const headEnd = config.customScripts?.headEnd ?? ""
  const bodyStart = config.customScripts?.bodyStart ?? ""
  const bodyEnd = config.customScripts?.bodyEnd ?? ""
  const robotsTxt =
    config.robots?.index === false ? "User-agent: *\nDisallow: /\n" : ""

  return {
    name: "figma-site-configuration",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!robotsTxt || req.url?.split("?")[0] !== "/robots.txt")
          return next()

        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.end(robotsTxt)
      })
    },
    generateBundle() {
      if (!robotsTxt) return

      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: robotsTxt,
      })
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let result = html
        result = replaceHtmlCommentSlot(result, "figma:lang", language)
        result = replaceHtmlCommentSlot(
          result,
          "figma:title",
          escapeHtmlText(title),
        )
        result = replaceHtmlCommentSlot(result, "figma:head-start", headStart)
        result = replaceHtmlCommentSlot(result, "figma:head-end", headEnd)
        result = replaceHtmlCommentSlot(result, "figma:body-start", bodyStart)
        result = replaceHtmlCommentSlot(result, "figma:body-end", bodyEnd)

        const tags: HtmlTagDescriptor[] = []
        if (description) {
          tags.push({
            tag: "meta",
            attrs: { name: "description", content: description },
            injectTo: "head",
          })
        }
        if (config.robots?.index === false) {
          tags.push({
            tag: "meta",
            attrs: { name: "robots", content: "noindex, nofollow" },
            injectTo: "head",
          })
        }
        if (favicon) {
          tags.push({
            tag: "link",
            attrs: { rel: "icon", href: favicon },
            injectTo: "head",
          })
        }
        if (title) {
          tags.push({
            tag: "meta",
            attrs: { property: "og:title", content: title },
            injectTo: "head",
          })
        }
        if (description) {
          tags.push({
            tag: "meta",
            attrs: { property: "og:description", content: description },
            injectTo: "head",
          })
        }
        if (socialImage) {
          tags.push(
            {
              tag: "meta",
              attrs: { property: "og:image", content: socialImage },
              injectTo: "head",
            },
            {
              tag: "meta",
              attrs: { name: "twitter:card", content: "summary_large_image" },
              injectTo: "head",
            },
            {
              tag: "meta",
              attrs: { name: "twitter:image", content: socialImage },
              injectTo: "head",
            },
          )
        }

        if (googleAnalyticsId) {
          tags.push(
            {
              tag: "script",
              attrs: {
                async: true,
                src: `https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`,
              },
              injectTo: "head",
            },
            {
              tag: "script",
              children: `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', ${JSON.stringify(googleAnalyticsId)});
`,
              injectTo: "head",
            },
          )
        }

        if (config.accessibility?.addBypassLinks) {
          tags.push(
            {
              tag: "style",
              children: `
  .figma-bypass-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 2147483647;
    transform: translateY(-150%);
    border-radius: 6px;
    background: #111827;
    color: #fff;
    padding: 8px 12px;
    font: 600 14px/1.2 system-ui, sans-serif;
    text-decoration: none;
  }
  .figma-bypass-link:focus {
    transform: translateY(0);
  }
`,
              injectTo: "head",
            },
            {
              tag: "a",
              attrs: { class: "figma-bypass-link", href: "#root" },
              children: "Skip to content",
              injectTo: "body-prepend",
            },
          )
        }

        return {
          html: result,
          tags,
        }
      },
    },
  }
}

/**
 * Injects the Content-Security-Policy as a <meta> element.
 *
 * A meta policy cannot express `frame-ancestors`, `report-uri` or `sandbox`,
 * so clickjacking protection still has to be delivered as a real HTTP header
 * by whatever serves the built files. Everything else is covered here.
 *
 * The served policy is looser than the built one on purpose: Vite's HMR needs
 * a WebSocket and the React Refresh preamble is an inline script, and neither
 * exists in a production bundle.
 */
function figmaContentSecurityPolicy(isDevServer: boolean): Plugin {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    /* The reader embeds PDFs through an <iframe>, so no plugin document is
     * ever legitimate here and <object>/<embed> are refused outright. */
    "object-src 'none'",
    isDevServer ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    /* 'unsafe-inline' stays in both policies: useScreenProtection injects a
     * <style> element at runtime to blank the page for printing, and a nonce
     * cannot cover an element application code creates itself. */
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    /* Covers and gallery images come from the CMS and may point at any https
     * origin, so img-src cannot be narrowed to 'self' without breaking assets
     * an administrator uploaded. */
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    /* The reader <iframe> now loads the PDF from a Supabase Storage signed
     * URL, which is cross-origin, so frame-src has to name *.supabase.co or
     * the viewer is blocked before it renders. YouTube/Vimeo stay for the
     * CMS media embeds. */
    "frame-src 'self' https://*.supabase.co https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
    /* Supabase is reached over HTTPS for PostgREST/Auth/Storage and over
     * WSS for Realtime, so connect-src has to name *.supabase.co or every
     * query the client issues is blocked before it leaves the browser.
     * The dev branch keeps ws:/wss: for Vite's own HMR socket. */
    isDevServer
      ? "connect-src 'self' ws: wss: https://*.supabase.co wss://*.supabase.co"
      : "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "form-action 'self'",
    ...(isDevServer ? [] : ["upgrade-insecure-requests"]),
  ]

  /* Turning on analytics in site.json injects an inline gtag snippet and a
   * googletagmanager.com script; both would be blocked until script-src is
   * widened to match. Nothing else in the app loads third-party script. */
  return {
    name: "figma-content-security-policy",
    transformIndexHtml: {
      order: "post",
      handler: () => [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content: directives.join("; "),
          },
          /* head-prepend, not head: a meta policy only governs resources
           * discovered after it is parsed, and appending to the head puts it
           * after the entry <script> the build injects — which would leave the
           * application bundle itself outside the policy. */
          injectTo: "head-prepend",
        },
      ],
    },
  }
}

/**
 * Replay the most recent build error to clients that connect after
 * it was first broadcast. Vite buffers an error payload only while
 * no clients are connected and clears the buffer on the first
 * reconnect (see `bufferedMessage` in `createWebSocketServer`), so
 * if the preview iframe reloads after Vite already delivered an
 * error to a live socket, the new socket misses the payload and
 * the overlay stays hidden even though the build is still broken.
 * We intercept `ws.send` to remember the latest error and replay
 * it on every new connection; the cache clears on a successful
 * `update` or `full-reload` so a stale overlay can't survive a
 * fixed build.
 */
function figmaErrorOverlayReplay(): Plugin {
  return {
    name: "figma-error-overlay-replay",
    apply: "serve",
    configureServer(server) {
      let lastError: object | null = null

      const origSend = server.ws.send.bind(server.ws) as (
        ...args: any[]
      ) => void
      server.ws.send = (((...args: any[]) => {
        const payload = args[0]
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const type = (payload as { type?: string }).type
          if (type === "error") {
            lastError = (payload as object)
          } else if (type === "update" || type === "full-reload") {
            lastError = null
          }
        }
        return origSend(...args)
      }) as typeof server.ws.send)

      server.ws.on("connection", (socket) => {
        if (lastError !== null) {
          socket.send(JSON.stringify(lastError))
        }
      })
    },
  }
}

/**
 * Reload when a module that previously defined a React Refresh boundary stops
 * defining one. This happens when an agent moves a component into a new file
 * and replaces the old module with a re-export:
 *
 *   export { default } from './app/App'
 *
 * Vite otherwise accepts the update using the previous module's HMR boundary,
 * but the re-export-only transform no longer registers a replacement for the
 * mounted component family. React reports a successful refresh while leaving
 * the old tree mounted until the page is reloaded.
 */
function figmaReactRefreshBoundaryFallback(): Plugin {
  const hadRefreshBoundary = new Map<string, boolean>()
  let sendFullReload: (() => void) | null = null

  return {
    name: "figma-react-refresh-boundary-fallback",
    apply: "serve",
    enforce: "post",
    configureServer(server) {
      sendFullReload = () => server.ws.send({ type: "full-reload", path: "*" })
    },
    transform(code, id) {
      if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes("/node_modules/"))
        return null

      const moduleId = id.split("?")[0] ?? id
      const hasRefreshBoundary = code.includes("registerExportsForReactRefresh")
      const previousHadRefreshBoundary = hadRefreshBoundary.get(moduleId)
      hadRefreshBoundary.set(moduleId, hasRefreshBoundary)

      if (previousHadRefreshBoundary && !hasRefreshBoundary) {
        queueMicrotask(() => sendFullReload?.())
      }

      return null
    },
  }
}

/**
 * Serves a blank render-target page at /.figma/make/kit.html that
 * the Figma preview script drives directly. The page exposes a
 * registry of every file matching `storiesGlob` on
 * window.__FIGMA__.stories so the design surface can dynamically
 * import + mount each entry into its own grid view.
 *
 * Dev-only: `apply: 'serve'` gates the plugin to `vite dev`. Prod
 * builds (`vite build`) skip it entirely so the route doesn't leak
 * into shipped bundles.
 */
function figmaMakeKitPlugin(options: {
  storiesGlob: string | string[]
}): Plugin {
  const storiesGlob = Array.isArray(options.storiesGlob)
    ? options.storiesGlob
    : [options.storiesGlob]
  const ROUTE = "/.figma/make/kit.html"
  const VIRTUAL_ID = "virtual:figma-stories"
  const RESOLVED_ID = "\0" + VIRTUAL_ID
  const STORIES_MODULE = `export const stories = import.meta.glob(${JSON.stringify(storiesGlob)})`
  const HTML_BOOTSTRAP = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
<div id="figma-make-kit-root"></div>
<script type="module">
  import { stories } from 'virtual:figma-stories'
  window.__FIGMA__ = Object.assign(window.__FIGMA__ ?? {}, { stories })
  window.dispatchEvent(new CustomEvent('figma.ready'))
</script>
</body>
</html>`

  return {
    name: "figma-make-kit",
    apply: "serve",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      return STORIES_MODULE
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ""
        if (url.split("?")[0] !== ROUTE) return next()

        try {
          res.setHeader("Content-Type", "text/html")
          res.end(await server.transformIndexHtml(url, HTML_BOOTSTRAP))
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}
