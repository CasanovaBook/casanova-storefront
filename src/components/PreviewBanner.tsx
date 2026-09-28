/**
 * Live-preview banner.
 *
 * Appears at the top of every page when the site is in Maestro preview mode
 * (?maestro-preview=1 in the URL). Gives the admin a clear visual signal that
 * they are seeing draft content, and a quick link back to the editor.
 */

import { useState } from "react";
import { previewEnabled } from "@/content/store";

export function PreviewBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (!previewEnabled() || dismissed) return null;

  return (
    <div
      dir="rtl"
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-4 py-2 text-sm font-medium shadow-lg"
      style={{
        background: "linear-gradient(90deg, #4f46e5, #7c3aed)",
        color: "#fff",
      }}
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          תצוגה מקדימה — שינויים טרם פורסמו
        </span>
        <a
          href="/HOWAMANTREATSYOU/content"
          className="underline underline-offset-2 hover:opacity-80 text-xs"
        >
          חזרה לעורך
        </a>
      </div>
      <div className="flex items-center gap-2">
        <a
          href={window.location.pathname}
          className="text-xs px-2.5 py-1 rounded-full border border-white/30 hover:bg-white/10 transition-colors"
        >
          מצב רגיל
        </a>
        <button
          onClick={() => setDismissed(true)}
          className="text-xs opacity-70 hover:opacity-100 transition-opacity"
          aria-label="סגור"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
