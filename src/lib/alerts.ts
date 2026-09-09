/* ─────────────────────────────────────────────────────────────
 * Operational alert detection.
 *
 * Alerts are never stored — they are derived from the live database on
 * every read, so an alert can never survive the condition that caused
 * it and can never be fabricated. Only the admin's "handled" decisions
 * are persisted (`dismissed_alerts`).
 * ───────────────────────────────────────────────────────────── */

import type { SystemAlert } from "../types"

import type { Database } from "./db"

function severityRank(sev: SystemAlert["severity"]): number {
  return sev === "CRITICAL" ? 3 : sev === "HIGH" ? 2 : sev === "MEDIUM" ? 1 : 0
}

const DAY_MS = 86_400_000

export function computeAlerts(db: Database): SystemAlert[] {
  const alerts: SystemAlert[] = []

  const {
    orders,
    user_products,
    invoices,
    email_logs,
    subscriptions,
    users,
    refunds,
    inquiries,
    products,
    settings,
  } = db

  const activeAccess = (userId: string, productId: string) =>
    user_products.some(
      (up) =>
        up.user_id === userId &&
        up.product_id === productId &&
        up.access_status === "ACTIVE",
    )

  orders.forEach((order) => {
    const itemLabel = (productId: string) =>
      order.items.find((i) => i.product_id === productId)?.product_name ??
      products.find((p) => p.product_id === productId)?.name ??
      productId

    if (
      order.payment_status === "PAID" ||
      order.payment_status === "PARTIALLY_REFUNDED"
    ) {
      order.items.forEach((item) => {
        if (!activeAccess(order.user_id, item.product_id)) {
          alerts.push({
            alert_id: `alert-access-${order.order_id}-${item.product_id}`,

            severity: "CRITICAL",

            title: "תשלום אושר אך הגישה לא נפתחה",

            description: `הזמנה ${order.order_number} שולמה, אך למוצר "${itemLabel(item.product_id)}" אין הרשאת גישה פעילה עבור הלקוח.`,

            related_type: "ACCESS",

            related_id: order.order_id,

            created_at: order.paid_at ?? order.created_at,
          })
        }
      })

      if (!invoices.some((inv) => inv.order_id === order.order_id)) {
        alerts.push({
          alert_id: `alert-invoice-${order.order_id}`,

          severity: "HIGH",

          title: "חשבונית לא הופקה",

          description: `ההזמנה ${order.order_number} שולמה בסכום ₪${order.total_amount.toLocaleString()}, אך טרם הונפקה לה חשבונית.`,

          related_type: "INVOICE",

          related_id: order.order_id,

          created_at: order.paid_at ?? order.created_at,
        })
      }

      const delivered = email_logs.some(
        (e) =>
          e.related_id === order.order_id &&
          e.template === "ORDER_PAID" &&
          (e.status === "SENT" || e.status === "DELIVERED"),
      )

      if (!delivered) {
        alerts.push({
          alert_id: `alert-email-${order.order_id}`,

          severity: "MEDIUM",

          title: "מייל קבלה לא אושר כנמסר",

          description: `לא נמצא מייל שנמסר בהצלחה אל ${order.customer_email} עבור הזמנה ${order.order_number}.`,

          related_type: "EMAIL",

          related_id: order.order_id,

          created_at: order.paid_at ?? order.created_at,
        })
      }
    }

    if (order.order_status === "FAILED" || order.payment_status === "FAILED") {
      alerts.push({
        alert_id: `alert-payment-${order.order_id}`,

        severity: "HIGH",

        title: "עסקת תשלום נכשלה",

        description: `התשלום עבור הזמנה ${order.order_number} (₪${order.total_amount.toLocaleString()}) נכשל. יש לעדכן את הלקוח או לבצע חיוב חלופי.`,

        related_type: "ORDER",

        related_id: order.order_id,

        created_at: order.created_at,
      })
    }

    if (
      order.payment_status === "PENDING" &&
      Date.now() - new Date(order.created_at).getTime() > DAY_MS
    ) {
      alerts.push({
        alert_id: `alert-pending-${order.order_id}`,

        severity: "MEDIUM",

        title: "הזמנה ממתינה לאישור תשלום",

        description: `הזמנה ${order.order_number} נרשמה לפני יותר מיום ועדיין ממתינה לאישור תשלום.`,

        related_type: "ORDER",

        related_id: order.order_id,

        created_at: order.created_at,
      })
    }
  })

  email_logs

    .filter((e) => e.status === "FAILED")

    .forEach((e) => {
      alerts.push({
        alert_id: `alert-emailfail-${e.email_log_id}`,

        severity: "MEDIUM",

        title: "מייל נכשל בשליחה",

        description: `המייל "${e.subject}" אל ${e.recipient} נכשל. ניתן לשלוח שוב ממסך המיילים.`,

        related_type: "EMAIL",

        related_id: e.email_log_id,

        created_at: e.sent_at,
      })
    })

  refunds

    .filter(
      (r) =>
        r.status === "REQUESTED" ||
        r.status === "PENDING" ||
        r.status === "APPROVED" ||
        r.status === "FAILED",
    )

    .forEach((r) => {
      const order = orders.find((o) => o.order_id === r.order_id)

      const stale = Date.now() - new Date(r.requested_at).getTime() > DAY_MS

      alerts.push({
        alert_id: `alert-refund-${r.refund_id}`,

        severity: r.status === "FAILED" ? "HIGH" : stale ? "MEDIUM" : "LOW",

        title:
          r.status === "FAILED"
            ? "החזר כספי נכשל ודורש טיפול"
            : r.status === "APPROVED"
              ? "החזר מאושר ממתין להוצאה לפועל"
              : "בקשת החזר ממתינה להחלטה",

        description: `הזמנה ${order?.order_number ?? r.order_id} · ₪${r.amount.toLocaleString()} · ${r.reason}`,

        related_type: "REFUND",

        related_id: r.refund_id,

        created_at: r.requested_at,
      })
    })

  inquiries

    .filter(
      (i) =>
        i.status === "NEW" ||
        i.status === "OPEN" ||
        i.status === "IN_PROGRESS" ||
        i.status === "WAITING_FOR_CUSTOMER",
    )

    .forEach((i) => {
      const stale = Date.now() - new Date(i.created_at).getTime() > DAY_MS

      alerts.push({
        alert_id: `alert-inquiry-${i.inquiry_id}`,

        severity:
          i.status === "NEW" && stale
            ? "HIGH"
            : i.status === "NEW"
              ? "MEDIUM"
              : "LOW",

        title:
          i.status === "NEW" ? "פניית לקוח חדשה ממתינה" : "פניית לקוח בטיפול",

        description: `${i.ticket_number} · ${i.customer_name} · ${i.subject}`,

        related_type: "INQUIRY",

        related_id: i.inquiry_id,

        created_at: i.created_at,
      })
    })

  subscriptions

    .filter((s) => s.status === "PAST_DUE")

    .forEach((s) => {
      const owner = users.find((u) => u.user_id === s.user_id)

      alerts.push({
        alert_id: `alert-sub-${s.subscription_id}`,

        severity: "HIGH",

        title: "מנוי בפיגור תשלום",

        description: `המנוי של ${
          owner ? `${owner.first_name} ${owner.last_name}` : s.user_id
        } נמצא בסטטוס "בפיגור". יש לטפל בחיוב.`,

        related_type: "SUBSCRIPTION",

        related_id: s.subscription_id,

        created_at: s.next_billing_date,
      })
    })

  subscriptions

    .filter((s) => s.status === "ACTIVE")

    .forEach((s) => {
      const owner = users.find((u) => u.user_id === s.user_id)

      if (owner && owner.account_status === "SUSPENDED") {
        alerts.push({
          alert_id: `alert-suspsub-${s.subscription_id}`,

          severity: "MEDIUM",

          title: "מנוי פעיל למשתמש מושעה",

          description: `למשתמש המושעה ${owner.first_name} ${owner.last_name} עדיין קיים מנוי פעיל.`,

          related_type: "SUBSCRIPTION",

          related_id: s.subscription_id,

          created_at: nowIso(),
        })
      }
    })

  const emailCounts = new Map<string, string[]>()

  users.forEach((u) => {
    const key = u.email.toLowerCase().trim()

    emailCounts.set(key, [
      ...(emailCounts.get(key) ?? []),
      `${u.first_name} ${u.last_name}`,
    ])
  })

  ;[...emailCounts.entries()]

    .filter(([, names]) => names.length > 1)

    .forEach(([email, names]) => {
      alerts.push({
        alert_id: `alert-dupemail-${email}`,

        severity: "HIGH",

        title: "כתובת מייל משוכפלת",

        description: `הכתובת ${email} מופיעה אצל ${names.length} משתמשים (${names.join(", ")}). יש למזג או לתקן.`,

        related_type: "USER",

        related_id: email,

        created_at: nowIso(),
      })
    })

  /* ── Configuration gaps ─────────────────────────────── */

  if (!settings.payment_provider) {
    alerts.push({
      alert_id: "alert-settings-payment",

      severity: "LOW",

      title: "לא הוגדר ספק תשלומים",

      description:
        "הזמנות נרשמות כממתינות ומאושרות ידנית ממסך ההזמנות. כדי לגבות תשלום באופן אוטומטי יש להגדיר ספק תשלומים בהגדרות הפלטפורמה.",

      related_type: "SETTINGS",

      related_id: "payment_provider",

      created_at: settings.updated_at,
    })
  }

  if (!settings.email_provider) {
    alerts.push({
      alert_id: "alert-settings-email",

      severity: "LOW",

      title: "לא הוגדר ספק שליחת מיילים",

      description:
        "הודעות נשמרות בתור בלבד ולא נמסרות ללקוחות. יש לחבר ספק מיילים בהגדרות הפלטפורמה.",

      related_type: "SETTINGS",

      related_id: "email_provider",

      created_at: settings.updated_at,
    })
  }

  if (!settings.refund_execution_enabled) {
    alerts.push({
      alert_id: "alert-settings-refunds",

      severity: "LOW",

      title: "החזרים כספיים מבוצעים מחוץ למערכת",

      description:
        "המערכת מאפשרת לרשום, לאשר ולדחות בקשות החזר, אך אינה מחזירה כסף בפועל. הפעלת ביצוע החזרים דורשת אינטגרציה מול ספק התשלומים.",

      related_type: "SETTINGS",

      related_id: "refund_execution_enabled",

      created_at: settings.updated_at,
    })
  }

  if (products.length === 0) {
    alerts.push({
      alert_id: "alert-settings-catalog",

      severity: "LOW",

      title: "הקטלוג ריק",

      description:
        "טרם הוגדרו מוצרים או ספרים. החנות ועמוד הבית מציגים מצב ריק עד להוספת תוכן דרך ה־CMS.",

      related_type: "SETTINGS",

      related_id: "products",

      created_at: nowIso(),
    })
  }

  return alerts.sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity),
  )
}

function nowIso(): string {
  return new Date().toISOString()
}
