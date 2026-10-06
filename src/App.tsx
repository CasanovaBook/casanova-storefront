import { RouterProvider } from "react-router"
import { AppProvider } from "./context/AppContext"
import { AdminProvider } from "./context/AdminContext"
import { CmsProvider } from "./context/CmsContext"
import { AccessibilityProvider } from "./context/AccessibilityContext"
import AccessibilityWidget from "./components/accessibility/AccessibilityWidget"
import { router } from "./routes"

/* AppProvider owns the session, so it wraps the two contexts that need
 * the signed-in actor to authorize their service calls.
 *
 * AccessibilityProvider sits outside the router on purpose: it is mounted
 * once for the whole app, so there is exactly one accessibility interface, it
 * is never remounted by navigation, and its preferences apply to every route
 * — storefront, login, checkout, dashboard, admin and the protected reader.
 * The widget is rendered here rather than inside a layout, for the same
 * reason: no shell can forget it, and no page can render a second one. */
export default function App() {
  return (
    <AppProvider>
      <CmsProvider>
        <AdminProvider>
          <AccessibilityProvider>
            <RouterProvider router={router} />
            <AccessibilityWidget />
          </AccessibilityProvider>
        </AdminProvider>
      </CmsProvider>
    </AppProvider>
  )
}
