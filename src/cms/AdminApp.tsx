/**
 * Maestro Admin — route definitions.
 */

import { Route, Routes } from "react-router";
import { AdminShell } from "./AdminShell";
import { AdminDashboard } from "./AdminDashboard";
import { ContentEditor } from "./ContentEditor";
import { BackupPage } from "./BackupPage";
import { AuditLogPage } from "./AuditLogPage";
import { MaestroProductsPage } from "./MaestroProductsPage";
import { MaestroPagesPage } from "./MaestroPagesPage";

function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-6" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">בבנייה — יטפל ב-CRUD של {title}.</p>
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
        <Route path="books" element={<Placeholder title="ניהול ספרים" />} />
        <Route path="media" element={<Placeholder title="ספריית מדיה" />} />
        <Route path="settings" element={<Placeholder title="הגדרות פלטפורמה" />} />
      </Route>
    </Routes>
  );
}
