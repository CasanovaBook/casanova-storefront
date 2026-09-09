/* ─────────────────────────────────────────────────────────────
 * Navigation types.
 *
 * Declared once so every `navigation.navigate()` call is checked
 * against the parameter list. A reader screen that receives a product
 * id it did not ask for is not a crash — it is a screen that mints a
 * grant for the wrong book.
 * ───────────────────────────────────────────────────────────── */

import type { NavigatorScreenParams } from "@react-navigation/native"

export type RootStackParamList = {
  /** Boot gate: the spinner, the kill-switch refusal, or the forced update. */

  Gate: undefined

  Login: undefined

  ForgotPassword: undefined

  Home: NavigatorScreenParams<HomeTabParamList> | undefined

  /**
   * The protected reader.
   *
   * `title` is carried on the params rather than looked up from the
   * catalogue, because the catalogue may not contain the product any
   * more by the time the reader opens it — an archived title still has
   * to be readable by the customer who bought it.
   */

  Reader: { productId: string, title: string, offline?: boolean }

  /** The customer's own list of authorised devices, with removal. */

  Devices: undefined
}

export type HomeTabParamList = {
  Library: undefined

  Store: undefined

  Dashboard: undefined

  Support: undefined
}
