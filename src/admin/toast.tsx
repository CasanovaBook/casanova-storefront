/**
 * Lightweight toast notification system for Maestro admin.
 *
 * Usage:
 *   import { Toaster, toast } from "@/admin/toast";
 *   <Toaster />              ← mount once in the layout
 *   toast.success("פורסם!")  ← show a green toast
 *   toast.error("שגיאה…")    ← show a red toast
 */

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/icons";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

let nextId = 0;
let addToastFn: ((t: Omit<Toast, "id">) => void) | null = null;

const TYPE_STYLES: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: {
    bg: "rgba(34,197,94,0.12)",
    border: "rgba(34,197,94,0.3)",
    color: "var(--color-success)",
    icon: "checkCircle",
  },
  error: {
    bg: "rgba(239,68,68,0.12)",
    border: "rgba(239,68,68,0.3)",
    color: "var(--color-danger)",
    icon: "alertCircle",
  },
  info: {
    bg: "rgba(227,174,60,0.12)",
    border: "rgba(227,174,60,0.3)",
    color: "var(--color-primary)",
    icon: "info",
  },
};

/** Mount once in the app layout. Renders all active toasts. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (!toasts.length) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none"
      dir="rtl"
    >
      {toasts.map((t) => {
        const s = TYPE_STYLES[t.type];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg animate-in slide-in-from-top fade-in duration-200"
            style={{
              background: s.bg,
              border: `1px solid ${s.border}`,
              color: s.color,
              backdropFilter: "blur(12px)",
              minWidth: 220,
            }}
          >
            <Icon name={s.icon as any} size={16} />
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Show a toast from anywhere. */
export const toast = {
  success(message: string) { addToastFn?.({ type: "success", message }); },
  error(message: string) { addToastFn?.({ type: "error", message }); },
  info(message: string) { addToastFn?.({ type: "info", message }); },
};
