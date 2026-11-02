/* A blocked device is signed out, not merely informed.

 * The reader's own lock screen offers "continue reading", which is the right
 * answer for a timeout and the wrong one for an administrator's decision:
 * leaving the account signed in on a device that was just blocked means the
 * token, the cached profile and the cart all stay live on a machine somebody
 * decided should not have them.
 *
 * So when this browser's own device comes back revoked, the session is torn
 * down here - grants purged, auth destroyed, reader sent to the login page -
 * rather than waiting for the next heartbeat to be convenient.
 *
 * This is a client-side teardown and it is worth naming what it is not: it
 * cannot reach a different device, and it is not what stops a blocked device
 * pulling pages. That is the session check in the reader-content function,
 * which refuses the request whether or not the browser cooperates. */

import { useEffect, useRef } from "react"
import { useNavigate } from "react-router"

import { useApp } from "../context/AppContext"
import type { Actor } from "../shared/result"
import { purgeLocalContentGrants } from "./api-security"
import {
  useDeviceSessions,
  type DeviceSessionsView,
} from "./useDeviceSessions"

export function useDeviceSessionGuard(
  actor: Actor | null,
  options: { staff?: boolean } = {},
): DeviceSessionsView {
  const view = useDeviceSessions(actor, options)
  const { logout } = useApp()
  const navigate = useNavigate()

  /* Once, and stickily. The teardown changes auth state, which re-renders
   * this tree with the same answer still in the document; without the latch
   * every render would sign the reader out again. */
  const torn = useRef(false)

  useEffect(() => {
    if (!view.blockedHere || torn.current) return

    torn.current = true

    if (actor) purgeLocalContentGrants(actor.user_id)

    void logout()

    navigate("/login", { replace: true })
  }, [actor, logout, navigate, view.blockedHere])

  return view
}
