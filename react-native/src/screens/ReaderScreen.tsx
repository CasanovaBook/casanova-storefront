/* ─────────────────────────────────────────────────────────────
 * ReaderScreen — the only place protected content is displayed.
 *
 * WHAT IS DELIBERATELY ABSENT
 * There is no download button, no save button, no share button, no
 * "open in another app", no print, and no export. Not hidden behind a
 * permission, not disabled behind a flag: absent. The most reliable way
 * to stop a file leaving an app is for the app never to offer a route
 * out, and every affordance removed here is one that would otherwise
 * need defending.
 *
 * WHAT IS PRESENT INSTEAD
 *  - the file is read from the private vault path only, and
 *    `assertInsideVault()` is called before the renderer is handed it,
 *    so a path from anywhere else throws instead of rendering;
 *  - the remote URL never reaches the renderer — the vault fetched it
 *    once and this screen only ever sees a local path;
 *  - link taps inside the document are refused and logged, because a
 *    link is the one way a PDF renderer will happily hand a URL to the
 *    system browser;
 *  - `restrictDocumentInteraction()` removes long-press text selection,
 *    which on iOS is the remaining route to a Copy/Share menu;
 *  - every page turn reports activity, so the session heartbeat knows
 *    the reader is in use, and progress is saved against the same
 *    `reading_progress` rows the web reader writes.
 * ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import Pdf from "react-native-pdf"

import type { NativeStackScreenProps } from "@react-navigation/native-stack"

import {
  Body,
  Button,
  Card,
  CenteredSpinner,
  Notice,
  ProgressBar,
  Screen,
  Title,
} from "../components/ui"

import { Watermark } from "../components/Watermark"

import { assertInsideVault } from "../drm/SecureFileVault"

import {
  PLATFORM_PROTECTION_NOTE,
  isCompromised,
  restrictDocumentInteraction,
} from "../drm/ScreenShield"

import { useReaderSession } from "../drm/useReaderSession"

import { fetchProgress, saveProgress } from "../net/api"

import type { DrmPolicy } from "../net/types"

import type { RootStackParamList } from "../navigation/routes"

import { useAuth } from "../store/AuthContext"

import { useProtection } from "../store/ProtectionContext"

import { colors, fontSize, radius, spacing, TAP_TARGET } from "../theme"

type Props = NativeStackScreenProps<RootStackParamList, "Reader">

const PHASE_LABEL: Record<string, string> = {
  registering: "מאמת את המכשיר מול השרת…",

  granting: "מנפיק אישור קריאה חד־פעמי…",

  fetching: "טוען את הספר לכספת המאובטחת…",
}

export function ReaderScreen({ navigation, route }: Props) {
  const { productId, title: routeTitle, offline = false } = route.params

  const { user } = useAuth()

  const protection = useProtection()

  const session = useReaderSession({ productId, user, offline })

  const {
    phase,
    filePath,
    watermark,
    message,
    permanent,
    downloadProgress,
    policy,
    report,
    retry,
    markActivity,
  } = session

  const [totalPages, setTotalPages] = useState(0)

  const [currentPage, setCurrentPage] = useState(1)

  const [showProtectionSheet, setShowProtectionSheet] = useState(false)

  const [progressError, setProgressError] = useState<string | null>(null)

  /* The server's policy replaces the client default the moment it
   * arrives, so the app-wide shield obeys the CMS rather than the
   * compiled fallback. */

  useEffect(() => {
    protection.setPolicy(policy)
  }, [policy, protection.setPolicy])

  /* Protection events raised anywhere in the app are attributed to this
   * product and session while the reader is open. */

  useEffect(() => {
    protection.attachReporter(report)

    return () => protection.attachReporter(null)
  }, [protection, report])

  /* Resume where the web reader or a previous phone session left off.
   * `reading_progress` is one table shared by both clients, so a chapter
   * finished in a browser opens in the same place here. */

  useEffect(() => {
    let cancelled = false

    void fetchProgress(productId).then((result) => {
      if (cancelled || !result.ok || !result.data) return

      const saved = result.data.current_page

      if (saved > 0) setCurrentPage(saved)
    })

    return () => {
      cancelled = true
    }
  }, [productId])

  /* iOS: strip long-press selection from the document view once it exists.
   * Re-run whenever the file changes, because a new document means a new
   * PDFKit view with fresh recognisers. */

  useEffect(() => {
    if (phase !== "ready" || !filePath) return

    let cancelled = false

    const timer = setTimeout(() => {
      if (cancelled) return

      void restrictDocumentInteraction().then((applied) => {
        if (!applied && !cancelled)
          report("COPY_BLOCKED", "document interaction could not be restricted")
      })
    }, 400)

    return () => {
      cancelled = true

      clearTimeout(timer)
    }
  }, [phase, filePath, report])

  const onPageChanged = useCallback(
    (page: number, pages: number) => {
      markActivity()

      setCurrentPage(page)

      setTotalPages(pages)

      /* Throttled by the server, which rewrites `last_read_at` at most
       * once a minute — the same rule the web reader applies, so a fast
       * swipe through a chapter does not become a write per page. */

      void saveProgress({
        product_id: productId,
        current_page: page,
        total_pages: pages,
      }).then((result) => {
        setProgressError(result.ok ? null : result.error)
      })
    },

    [markActivity, productId],
  )

  /* A link inside a protected PDF is the one gesture that can hand a URL
   * to something outside this app. Refuse it, say why, and record it:
   * repeated attempts are a probe, not an accident. */

  const onPressLink = useCallback(
    (url: string) => {
      report("DOWNLOAD_BLOCKED", `link refused: ${url.slice(0, 120)}`)

      setProgressError(
        "קישורים מתוך הספר חסומים. התוכן זמין לקריאה בתוך האפליקציה בלבד.",
      )
    },

    [report],
  )

  const onError = useCallback(
    (error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)

      report("DOWNLOAD_BLOCKED", `renderer error: ${detail.slice(0, 200)}`)

      setProgressError(
        "הקובץ לא נפתח. ייתכן שהעותק המקומי נמחק — נסו לפתוח את הספר שוב.",
      )
    },

    [report],
  )

  /* The renderer is only ever given a vault path. If anything ever
   * produces a path outside it, this yields an error instead of quietly
   * rendering a file from Downloads. */

  const resolved = useMemo<{ uri: string } | { error: string } | null>(() => {
    if (!filePath) return null

    try {
      assertInsideVault(filePath)
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "נתיב הקובץ אינו תקין",
      }
    }

    return { uri: `file://${filePath}` }
  }, [filePath])

  const source = resolved && "uri" in resolved ? resolved : null

  const sourceError = resolved && "error" in resolved ? resolved.error : null

  const compromised = isCompromised(session.integrity)

  /* ── Loading ──────────────────────────────────────────── */

  if (
    phase === "registering" ||
    phase === "granting" ||
    phase === "fetching" ||
    phase === "idle"
  ) {
    return (
      <Screen>
        <View style={styles.centered}>
          <CenteredSpinner label={PHASE_LABEL[phase] ?? "טוען…"} />
          {phase === "fetching" && downloadProgress > 0 ? (
            <View style={styles.progressShell}>
              <ProgressBar
                value={downloadProgress}
                label={`${Math.round(downloadProgress * 100)}%`}
              />
            </View>
          ) : null}
        </View>
      </Screen>
    )
  }

  /* ── Blocked / error ──────────────────────────────────── */

  if (phase === "blocked" || phase === "error" || !source || sourceError) {
    const text = sourceError ?? message

    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.errorScroll}>
          <Title>לא ניתן לפתוח את הספר</Title>
          <Notice
            tone={phase === "blocked" ? "danger" : "warn"}
            title={permanent ? "הגישה נחסמה" : "שגיאה זמנית"}
          >
            {text ?? "הקריאה נעצרה. נסו שוב או פנו לתמיכה."}
          </Notice>

          {compromised ? (
            <Notice tone="danger" title="המכשיר זוהה כפרוץ">
              מדיניות ההגנה של המערכת אוסרת קריאה בתוכן מוגן במכשיר עם הרשאות
              root, jailbreak או במדמה. האירוע תועד במערכת.
            </Notice>
          ) : null}

          {session.revoked ? (
            <Notice tone="danger" title="העותק המקומי נמחק">
              הגישה ממכשיר זה נחסמה. כל הקבצים השמורים במכשיר נמחקו ולא ניתן
              לשחזר אותם.
            </Notice>
          ) : null}

          {progressError ? <Notice tone="warn">{progressError}</Notice> : null}

          {!permanent ? (
            <Button label="ניסיון נוסף" onPress={retry} />
          ) : (
            <Button
              label="חזרה לספרייה"
              variant="ghost"
              onPress={() => navigation.goBack()}
            />
          )}
        </ScrollView>
      </Screen>
    )
  }

  /* ── Reading ──────────────────────────────────────────── */

  return (
    <Screen style={styles.readerScreen} edges={["top", "left", "right"]}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="חזרה"
          onPress={() => navigation.goBack()}
          style={styles.toolButton}
        >
          <Text style={styles.toolGlyph}>›</Text>
        </Pressable>

        <View style={styles.toolbarTitle}>
          <Text numberOfLines={1} style={styles.toolbarTitleText}>
            {routeTitle}
          </Text>
          <Text numberOfLines={1} style={styles.toolbarMeta}>
            {totalPages > 0
              ? `עמוד ${currentPage} מתוך ${totalPages}`
              : "עותק אישי מוגן"}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="מה מוגן בקריאה הזו"
          onPress={() => setShowProtectionSheet(true)}
          style={styles.toolButton}
        >
          <Text style={styles.toolGlyph}>⛨</Text>
        </Pressable>
      </View>

      {progressError ? (
        <View style={styles.inlineNotice}>
          <Text style={styles.inlineNoticeText}>{progressError}</Text>
        </View>
      ) : null}

      <View style={styles.pdfShell}>
        <Pdf
          source={source}
          style={styles.pdf}
          page={currentPage}
          /* Hebrew books read right to left; `enableRTL` makes the
           * renderer lay pages out that way instead of fighting the
           * swipe direction. */

          enableRTL
          fitPolicy={2}
          enablePaging={false}
          singlePage={false}
          horizontal={false}
          /* Never accept a self-signed certificate for a content fetch.
           * A renderer that trusts any certificate will hand the file to
           * whoever is in the middle. */

          trustAllCerts={false}
          enableAnnotationRendering={false}
          onLoadComplete={(pages: number) => {
            setTotalPages(pages)

            void restrictDocumentInteraction()
          }}
          onPageChanged={onPageChanged}
          onPressLink={onPressLink}
          onError={onError}
        />

        <Watermark
          text={watermark}
          enabled={policy.watermark_enabled}
          opacity={policy.watermark_opacity}
        />
      </View>

      <ProtectionSheet
        visible={showProtectionSheet}
        onClose={() => setShowProtectionSheet(false)}
        policy={policy}
      />
    </Screen>
  )
}

/* ── Protection sheet ───────────────────────────────────── */

/**
 * Tells the reader what is and is not possible.
 *
 * This is not reassurance copy. A user who believes a screenshot is
 * impossible on iOS will not understand why the screen went black when
 * they tried one, and a user who believes the file is uncopyable will
 * not understand why they cannot send it to a friend. Stating the limit
 * plainly is what makes the restrictions legible instead of looking like
 * a bug.
 */

function ProtectionSheet({
  visible,

  onClose,

  policy,
}: {
  visible: boolean

  onClose: () => void

  policy: DrmPolicy
}) {
  const rows: { label: string, value: string }[] = [
    {
      label: "צילום מסך והקלטת מסך",
      value: policy.block_screenshots ? "חסומים" : "מותרים לפי המדיניות",
    },

    {
      label: "הורדה, שמירה ושיתוף הקובץ",
      value: policy.block_download ? "חסומים לחלוטין" : "מותרים לפי המדיניות",
    },

    {
      label: "קריאה ללא חיבור",
      value: policy.allow_offline ? "מותרת לזמן מוגבל" : "אסורה",
    },

    {
      label: "סימון אישי על העמודים",
      value: policy.watermark_enabled ? "פעיל" : "כבוי",
    },

    {
      label: "עותקים שמורים במכשיר",
      value: "נמחקים בניתוק, בחסימת מכשיר ובסיום התוקף",
    },
  ]

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.sheetBackdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="סגירה"
      />
      <View style={styles.sheet}>
        <Title size="md">מה מוגן בקריאה הזו</Title>
        <ScrollView style={styles.sheetScroll}>
          {rows.map((row) => (
            <View key={row.label} style={styles.sheetRow}>
              <Text style={styles.sheetRowLabel}>{row.label}</Text>
              <Text style={styles.sheetRowValue}>{row.value}</Text>
            </View>
          ))}
          <Card style={styles.sheetNote}>
            <Body muted>{PLATFORM_PROTECTION_NOTE}</Body>
          </Card>
          <Card style={styles.sheetNote}>
            <Body muted>
              הקובץ נשמר בכספת פרטית של האפליקציה בלבד, אינו מועבר לאפליקציות
              אחרות ואינו נכלל בגיבוי המכשיר. כל עמוד נושא את פרטי החשבון שלכם,
              כך שכל הדלפה ניתנת לאיתור.
            </Body>
          </Card>
        </ScrollView>
        <Button label="סגירה" onPress={onClose} />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  readerScreen: { backgroundColor: "#000" },

  centered: { flex: 1, justifyContent: "center" },

  progressShell: { paddingHorizontal: spacing.xxl, marginTop: -spacing.xxl },

  errorScroll: { padding: spacing.xl, flexGrow: 1 },

  toolbar: {
    flexDirection: "row",

    alignItems: "center",

    paddingHorizontal: spacing.sm,

    paddingVertical: spacing.xs,

    backgroundColor: colors.surface,

    borderBottomWidth: 1,

    borderBottomColor: colors.border,
  },

  toolButton: {
    width: TAP_TARGET,

    height: TAP_TARGET,

    alignItems: "center",

    justifyContent: "center",
  },

  toolGlyph: { color: colors.primary, fontSize: 22, lineHeight: 26 },

  toolbarTitle: { flex: 1, paddingHorizontal: spacing.xs },

  toolbarTitleText: {
    color: colors.foreground,
    fontSize: fontSize.md,
    fontWeight: "600",
    writingDirection: "rtl",
  },

  toolbarMeta: {
    color: colors.muted,
    fontSize: fontSize.xs,
    writingDirection: "rtl",
  },

  inlineNotice: {
    backgroundColor: colors.surfaceRaised,

    borderStartWidth: 3,

    borderStartColor: colors.primary,

    paddingHorizontal: spacing.md,

    paddingVertical: spacing.sm,
  },

  inlineNoticeText: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    writingDirection: "rtl",
  },

  pdfShell: { flex: 1, backgroundColor: "#000" },

  pdf: { flex: 1, backgroundColor: "#000" },

  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
  },

  sheet: {
    position: "absolute",

    start: 0,

    end: 0,

    bottom: 0,

    backgroundColor: colors.surface,

    borderTopStartRadius: radius.lg,

    borderTopEndRadius: radius.lg,

    padding: spacing.lg,

    maxHeight: "82%",
  },

  sheetScroll: { marginBottom: spacing.md },

  sheetRow: {
    flexDirection: "row",

    justifyContent: "space-between",

    paddingVertical: spacing.sm,

    borderBottomWidth: 1,

    borderBottomColor: colors.border,

    gap: spacing.md,
  },

  sheetRowLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: fontSize.sm,
    writingDirection: "rtl",
  },

  sheetRowValue: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.sm,
    textAlign: "left",
    writingDirection: "rtl",
  },

  sheetNote: { marginTop: spacing.md },
})

export default ReaderScreen
