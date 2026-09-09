/* ─────────────────────────────────────────────────────────────
 * App root.
 *
 * Three decisions are made here and nowhere else:
 *
 *  1. RTL is forced before the first render. The screens do not depend
 *     on it — every text style sets `writingDirection` explicitly and
 *     every row lays out with `flexDirection: 'row'` plus mirrored
 *     padding — but forcing it makes the platform's own widgets (the
 *     text-selection handles, the keyboard's language row, the native
 *     `Alert` button order) agree with the app instead of fighting it.
 *
 *  2. The provider order is fixed. `Auth` is outermost because the
 *     protection policy is derived from a signed-in device session and
 *     the library only loads while signed in. `Protection` sits above
 *     the navigator so the shield owns the window for the whole app
 *     lifetime rather than per screen — see the note in
 *     `src/store/ProtectionContext.tsx` for why that matters during
 *     transitions.
 *
 *  3. A render error is caught, and catching it wipes the vault. This is
 *     the last line of the "no permanent copy" rule: if the reader
 *     throws halfway through a session, the normal unmount cleanup may
 *     never run, and the bytes would sit in the sandbox with nothing
 *     tracking their TTL.
 * ───────────────────────────────────────────────────────────── */

import { Component, type ErrorInfo, type ReactNode } from "react"

import {
  I18nManager,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SafeAreaProvider } from "react-native-safe-area-context"

import { wipeAll } from "./src/drm/SecureFileVault"

import { RootNavigator } from "./src/navigation/RootNavigator"

import { AuthProvider } from "./src/store/AuthContext"

import { LibraryProvider } from "./src/store/LibraryContext"

import { ProtectionProvider } from "./src/store/ProtectionContext"

import { colors, fontSize, spacing } from "./src/theme"

/* Module scope, not inside a component: this has to have run before the
 * first layout pass measures anything.
 *
 * `forceRTL` only takes effect on the *next* launch, which normally means
 * an app restart is required to see it. None is needed here, for the
 * reason in the header — the UI is RTL by its own styles, so the first
 * launch already looks right and the flag simply catches up to it. */

I18nManager.allowRTL(true)

I18nManager.forceRTL(true)

interface BoundaryProps {
  children: ReactNode
}

interface BoundaryState {
  error: Error | null
}

/**
 * Catches anything thrown while rendering, in a lifecycle method or in a
 * constructor of the whole tree.
 *
 * The fallback is deliberately opaque black with no diagnostic detail on
 * screen. A React error box renders the component stack, and on a device
 * that is being recorded that text is visible in the capture; the useful
 * part of it goes to the console, where a developer can read it and a
 * screenshot cannot.
 */

class CrashBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static override getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* Not reported to `security_events`: the session that would carry the
     * report may itself be what threw, and a fire-and-forget POST from
     * inside an error boundary is a POST nobody can confirm landed. */

    console.error(
      "[CasanovaReader] fatal render error",
      error,
      info.componentStack,
    )

    void wipeAll().catch(() => undefined)
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <View style={styles.crash}>
        <Text style={styles.crashTitle}>האפליקציה נסגרה להגנה על התוכן</Text>
        <Text style={styles.crashBody}>
          אירעה שגיאה בלתי צפויה. כל עותק שנשמר במכשיר זה נמחק. פתחו את
          האפליקציה מחדש, והספרים שלכם ימשיכו להיות זמינים בחשבון.
        </Text>
        <Text style={styles.crashHint}>
          אם זה קורה שוב, פנו לתמיכה דרך האתר.
        </Text>
      </View>
    )
  }
}

export function App(): ReactNode {
  return (
    <CrashBoundary>
      <SafeAreaProvider style={styles.root}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={
            Platform.OS === "android" ? colors.background : undefined
          }
          /* Not translucent: with a translucent status bar the root view
           * extends under it, and the shield overlay — which is a child of
           * the root view — would then have to cover the system bar too.
           * Keeping the bar opaque means the overlay only ever has to hide
           * app content, which is all it is responsible for. */

          translucent={false}
          networkActivityIndicatorVisible
        />
        <AuthProvider>
          <ProtectionProvider>
            <LibraryProvider>
              <RootNavigator />
            </LibraryProvider>
          </ProtectionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </CrashBoundary>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  crash: {
    flex: 1,

    /* Pure black, matching the shield overlay: this screen can appear
     * over a partially rendered reader, and a lighter background would
     * make whatever is behind it legible in a capture. */

    backgroundColor: colors.shield,

    paddingHorizontal: spacing.xl,

    justifyContent: "center",

    gap: spacing.md,
  },

  crashTitle: {
    color: colors.foreground,

    fontSize: fontSize.lg,

    fontWeight: "700",

    textAlign: "center",

    writingDirection: "rtl",
  },

  crashBody: {
    color: colors.muted,

    fontSize: fontSize.md,

    lineHeight: 24,

    textAlign: "center",

    writingDirection: "rtl",
  },

  crashHint: {
    color: colors.muted,

    fontSize: fontSize.xs,

    textAlign: "center",

    writingDirection: "rtl",
  },
})

export default App
