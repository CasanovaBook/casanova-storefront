import { useCallback, useRef, useState } from "react"

import type { Result } from "../../lib/api"

/**
 * Shared behaviour for the entitlement action buttons on /admin/access and
 * the access tab of the user dialog.
 *
 * The RPC plumbing underneath (context → api-support → admin_* SECURITY
 * DEFINER functions) already resolves every failure into a `Result`; what
 * was missing was the UI around it: handlers did `void promise` and threw
 * the result away, so a refused or failed call looked like a dead button.
 * This hook makes every action
 *
 *   - show a busy state keyed by the entitlement id (prevents double fire),
 *   - ask for confirmation on the destructive ones,
 *   - surface the real error message on failure,
 *   - report success so the caller can flash feedback.
 *
 * The caller keeps ownership of rendering; nothing here mutates data.
 */

export interface AccessActionResult {
  ok: boolean
  error?: string
}

export function useAccessActions() {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  /* Guards against a stale success/error overwrite after a second action. */
  const runSeq = useRef(0)

  const clearFeedback = useCallback(() => {
    setError("")
    setSuccess("")
  }, [])

  /**
   * Runs one action. `confirmQuestion` (optional) gates destructive
   * actions; declining is silent, not an error.
   */
  const run = useCallback(
    async (
      userProductId: string,
      action: () => Promise<Result>,
      opts?: { confirm?: string; successMessage?: string },
    ): Promise<boolean> => {
      if (busyId) return false /* an action is already in flight */

      if (opts?.confirm && !window.confirm(opts.confirm)) return false

      const seq = ++runSeq.current
      setBusyId(userProductId)
      setError("")
      setSuccess("")

      const result = await action()

      if (seq === runSeq.current) {
        setBusyId(null)
        if (result.ok) {
          setSuccess(opts?.successMessage ?? "הפעולה בוצעה בהצלחה")
        } else {
          setError(result.error)
        }
      }
      return result.ok
    },
    [busyId],
  )

  return { busyId, error, success, run, clearFeedback }
}
