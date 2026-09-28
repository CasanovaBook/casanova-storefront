import { Suspense, lazy, type ComponentType } from "react"

import { createBrowserRouter } from "react-router"

import PublicRoot from "./components/layout/PublicRoot"

import DashboardLayout from "./components/layout/DashboardLayout"

import AdminLayout from "./components/layout/AdminLayout"

import LoginPage from "./pages/LoginPage"

import RouteError, { NotFoundPage } from "./components/RouteError"

/**
 * Route table.
 *
 * The storefront entry points — landing, login and the three layout
 * shells — stay in the initial bundle because they are what a first
 * visit actually needs. Everything else is loaded on demand, so the
 * 13-screen admin panel, the protected reader and the checkout flow no
 * longer ship to a visitor who only came to look at the catalogue.
 *
 * Each lazy page keeps its own authorization check inside the component;
 * splitting the bundle is a delivery decision and must never change who
 * is allowed to see what.
 *
 * Every top-level branch carries an `errorElement`, so a throw anywhere in
 * its subtree lands on a Hebrew recovery screen instead of React Router's
 * own developer page — which is untranslated and prints the component stack
 * into the DOM for whoever triggered it.
 */

function lazyPage(loader: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(loader)

  return function LazyPage() {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Page />
      </Suspense>
    )
  }
}

/** Shown for the moment a split chunk is in flight. */

function RouteFallback() {
  return (
    <div
      className="min-h-[40vh] flex flex-col items-center justify-center gap-3"
      style={{ color: "var(--color-muted-foreground)" }}
      role="status"
      aria-live="polite"
    >
      <span
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{
          borderColor: "var(--color-border)",
          borderTopColor: "var(--color-primary)",
        }}
      />
      <span className="text-xs">טוען…</span>
    </div>
  )
}

const SetupPage = lazyPage(() => import("./pages/SetupPage"))

const SetupPasswordPage = lazyPage(() => import("./pages/SetupPasswordPage"))

const ForgotPasswordPage = lazyPage(() => import("./pages/ForgotPasswordPage"))

/* Where a signup verification link lands. It renders its own states
 * (checking / confirmed / expired / no-session) and only then hands
 * over to the dashboard, so the confirmation is never skipped. */
const VerifyEmailPage = lazyPage(() => import("./pages/VerifyEmailPage"))

const SupportPage = lazyPage(() => import("./pages/SupportPage"))

const CheckoutPage = lazyPage(() => import("./pages/CheckoutPage"))

const CheckoutSuccessPage = lazyPage(
  () => import("./pages/CheckoutSuccessPage"),
)

const SalesLandingPage = lazyPage(() => import("./pages/SalesLandingPage"))

const TermsPage = lazyPage(() => import("./pages/TermsPage"))

const CancellationPolicyPage = lazyPage(() => import("./pages/CancellationPolicyPage"))

const StorePage = lazyPage(() => import("./pages/StorePage"))

const DashboardPage = lazyPage(() => import("./pages/DashboardPage"))

const LibraryPage = lazyPage(() => import("./pages/LibraryPage"))

const ReaderPage = lazyPage(() => import("./pages/ReaderPage"))

const AdminDashboardPage = lazyPage(
  () => import("./pages/admin/AdminDashboardPage"),
)

const AdminProductsPage = lazyPage(
  () => import("./pages/admin/AdminProductsPage"),
)

const AdminUsersPage = lazyPage(() => import("./pages/admin/AdminUsersPage"))

const AdminOrdersPage = lazyPage(() => import("./pages/admin/AdminOrdersPage"))

const AdminCrmPage = lazyPage(() => import("./pages/admin/AdminCrmPage"))

const AdminCmsPage = lazyPage(() => import("./pages/admin/AdminCmsPage"))

const AdminAccessPage = lazyPage(() => import("./pages/admin/AdminAccessPage"))

const AdminFinancePage = lazyPage(
  () => import("./pages/admin/AdminFinancePage"),
)

const AdminEmailsPage = lazyPage(() => import("./pages/admin/AdminEmailsPage"))

const AdminAlertsPage = lazyPage(() => import("./pages/admin/AdminAlertsPage"))

const AdminAuditPage = lazyPage(() => import("./pages/admin/AdminAuditPage"))

const AdminSupportPage = lazyPage(
  () => import("./pages/admin/AdminSupportPage"),
)

const AdminSettingsPage = lazyPage(
  () => import("./pages/admin/AdminSettingsPage"),
)

const DynamicCmsPage = lazyPage(() => import("./pages/DynamicCmsPage"))

const AdminSecurityPage = lazyPage(
  () => import("./pages/admin/AdminSecurityPage"),
)

const MaestroAdminApp = lazyPage(() => import("./admin/AdminApp").then(m => ({ default: m.AdminApp })))

export const router = createBrowserRouter([
  {
    // Main landing page: the "היא קודם" sales letter, standalone with

    // no PublicRoot chrome, served directly at the site root.

    path: "/",

    Component: SalesLandingPage,

    errorElement: <RouteError />,
  },


  {

    // Standalone, like the landing page above: a verification link must

    // never render inside the storefront chrome, and it must not sit under

    // a layout whose guard could redirect it before the session has been

    // restored. The page resolves its own state and picks its own next step.

    path: "/verify-email",

    Component: VerifyEmailPage,

    errorElement: <RouteError />,
  },

  {

    // Previous redirect target, kept resolving so verification links that

    // are already sitting in real inboxes still land on the confirmation

    // screen rather than the not-found page.

    path: "/email-confirmed",

    Component: VerifyEmailPage,

    errorElement: <RouteError />,
  },

  {
    path: "/",

    Component: PublicRoot,

    errorElement: <RouteError />,

    children: [
      {
        // Public catalogue. Same component the signed-in dashboard

        // renders, reachable without an account: browsing is not a

        // privileged action, only reading purchased content is.

        path: "store",

        Component: StorePage,
      },

      { path: "checkout", Component: CheckoutPage },

      { path: "checkout/success", Component: CheckoutSuccessPage },

      { path: "support", Component: SupportPage },

      { path: "terms-and-conditions", Component: TermsPage },

      { path: "cancellation-and-refund-policy", Component: CancellationPolicyPage },

      { path: "setup-password", Component: SetupPasswordPage },

      { path: "forgot-password", Component: ForgotPasswordPage },

      {
        // Dynamic CMS pages created from Maestro. Fetches from cms_pages
        // by slug and renders Markdown content. Must be before the
        // catch-all so it matches /pages/<slug> first.
        path: "pages/:slug",
        Component: DynamicCmsPage,
      },

      /* Anything the table does not define, rendered inside the storefront
       * shell: a visitor who follows a stale link still gets the header, the
       * navigation and a way out instead of a bare dead end. Left out
       * entirely, the router answers with its own English 404 screen. */

      { path: "*", Component: NotFoundPage },
    ],
  },

  {
    // Auth screens are siblings of the sales letter and of PublicRoot, not
    // children of the storefront chrome. LoginPage already draws its own
    // full-page shell; nesting it under PublicRoot made /login look like a
    // "login subpage" of the public layout, and register lived on that same
    // path via local state. Distinct URLs, one component.

    path: "/login",

    Component: LoginPage,

    errorElement: <RouteError />,
  },

  {
    path: "/register",

    Component: LoginPage,

    errorElement: <RouteError />,
  },

  {
    // First-run installation: the screen that creates the very first admin.

    path: "/setup",

    Component: SetupPage,

    errorElement: <RouteError />,
  },

  {
    path: "/dashboard",

    Component: DashboardLayout,

    errorElement: <RouteError />,

    children: [
      { index: true, Component: DashboardPage },

      { path: "library", Component: LibraryPage },

      { path: "store", Component: StorePage },
    ],
  },

  {
    path: "/read/:productId",

    Component: ReaderPage,

    errorElement: <RouteError />,
  },

  {
    path: "/admin",

    Component: AdminLayout,

    errorElement: <RouteError />,

    children: [
      { index: true, Component: AdminDashboardPage },

      { path: "products", Component: AdminProductsPage },

      { path: "users", Component: AdminUsersPage },

      { path: "access", Component: AdminAccessPage },

      { path: "orders", Component: AdminOrdersPage },

      { path: "finance", Component: AdminFinancePage },

      { path: "emails", Component: AdminEmailsPage },

      { path: "alerts", Component: AdminAlertsPage },

      { path: "audit", Component: AdminAuditPage },

      { path: "crm", Component: AdminCrmPage },

      { path: "cms", Component: AdminCmsPage },

      { path: "support", Component: AdminSupportPage },

      { path: "security", Component: AdminSecurityPage },

      { path: "settings", Component: AdminSettingsPage },
    ],
  },

  {
    // Maestro CMS admin — accessible at /HOWAMANTREATSYOU
    // Uses Casanova admin session (SSO). No separate login required.
    // Any admin with cms:edit_live permission can access.
    path: "/HOWAMANTREATSYOU/*",
    Component: MaestroAdminApp,
    errorElement: <RouteError />,
  },
])
