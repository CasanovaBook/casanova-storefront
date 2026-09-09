import { RouterProvider } from "react-router"
import { AppProvider } from "./context/AppContext"
import { AdminProvider } from "./context/AdminContext"
import { CmsProvider } from "./context/CmsContext"
import { router } from "./routes"

/* AppProvider owns the session, so it wraps the two contexts that need
 * the signed-in actor to authorize their service calls. */
export default function App() {
  return (
    <AppProvider>
      <CmsProvider>
        <AdminProvider>
          <RouterProvider router={router} />
        </AdminProvider>
      </CmsProvider>
    </AppProvider>
  )
}
