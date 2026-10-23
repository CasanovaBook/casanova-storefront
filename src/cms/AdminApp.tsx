/**
 * Maestro Admin — route definitions.
 */

import { Link, Route, Routes } from "react-router";
import { AdminShell } from "./AdminShell";
import { AdminDashboard } from "./AdminDashboard";
import { ContentEditor } from "./ContentEditor";
import { BackupPage } from "./BackupPage";
import { AuditLogPage } from "./AuditLogPage";
import { MaestroProductsPage } from "./MaestroProductsPage";
import { MaestroPagesPage } from "./MaestroPagesPage";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import type { IconName } from "@/components/icons";

function Placeholder({
  title,
  description,
  icon,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  description: string;
  icon: IconName;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS"
        title={title}
        description={`${title} הוא מודול מתוכנן ב-Maestro CMS, אך הוא עדיין לא זמין.`}
      />

      <EmptyState
        icon={icon}
        title="המודול עדיין לא זמין"
        description={
          <>
            {description}
            <span className="mt-3 block text-xs" style={{ color: "var(--color-muted-foreground)" }}>
              אין כאן פעולות מדומות או נתוני דוגמה — המסך ייפתח רק כשייושם המודול.
            </span>
          </>
        }
        actions={
          <>
            <Link to={primaryHref} className="app-btn-secondary">
              {primaryLabel}
            </Link>
            {secondaryHref && secondaryLabel && (
              <Link to={secondaryHref} className="app-btn-ghost">
                {secondaryLabel}
              </Link>
            )}
          </>
        }
      />
    </div>
  );
}


function CmsNotFound() {
  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS"
        title="העמוד לא נמצא"
        description="הכתובת שביקשתם אינה קיימת בתוך Maestro CMS."
        breadcrumbs={[
          { label: "Maestro CMS", to: "/admin/cms/content-editor" },
          { label: "העמוד לא נמצא" },
        ]}
      />
      <EmptyState
        icon="search"
        title="לא נמצא עמוד CMS"
        description="ייתכן שהקישור השתנה או שהעמוד הוסר. אפשר לחזור ללוח הבקרה ולהמשיך משם."
        actions={
          <Link to="/admin/cms/content-editor" className="app-btn">
            חזרה ללוח הבקרה
          </Link>
        }
      />
    </div>
  );
}

export function AdminApp() {
  return (
    <Routes>
      <Route element={<AdminShell />}>
        <Route index element={<AdminDashboard />} />
        <Route path="content" element={<ContentEditor />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="products" element={<MaestroProductsPage />} />
        <Route path="pages" element={<MaestroPagesPage />} />
        <Route
          path="books"
          element={
            <Placeholder
              title="ניהול ספרים"
              icon="book"
              description="ניהול ספרים ייעודי (כותרות, קבצים ותצוגות) אינו חלק מ-Maestro CMS. מוצרים דיגיטליים קיימים מנוהלים במסך המוצרים הראשי של האדמין."
              primaryHref="/admin/products"
              primaryLabel="לניהול המוצרים הראשי"
              secondaryHref="/admin/cms/content-editor/products"
              secondaryLabel="למסך המוצרים ב-Maestro"
            />
          }
        />
        <Route
          path="media"
          element={
            <Placeholder
              title="ספריית מדיה"
              icon="inbox"
              description="אין עדיין ספריית מדיה מרכזית. תמונות מוגדרות כיום בשדות תמונה בעורך התוכן ובכרטיס המוצר, באמצעות כתובת URL."
              primaryHref="/admin/cms/content-editor/content"
              primaryLabel="לעריכת התוכן"
              secondaryHref="/admin/products"
              secondaryLabel="לניהול המוצרים"
            />
          }
        />
        <Route
          path="settings"
          element={
            <Placeholder
              title="הגדרות פלטפורמה"
              icon="settings"
              description="הגדרות הפלטפורמה אינן מנוהלות מתוך Maestro. ההגדרות הקיימות זמינות במסך ההגדרות הראשי של האדמין."
              primaryHref="/admin/settings"
              primaryLabel="להגדרות הפלטפורמה"
            />
          }
        />
        <Route path="*" element={<CmsNotFound />} />
      </Route>
    </Routes>
  );
}
