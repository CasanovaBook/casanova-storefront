/* ─────────────────────────────────────────────────────────────
 * GateScreen — the boot verdict.
 *
 * Rendered while the kill switch and the forced-update floor are being
 * evaluated, and stays on screen when the answer is "this build may not
 * run". It is a full screen rather than a banner because a build that
 * was pulled for a security reason must not render any part of the
 * authenticated app while the refusal is being explained.
 * ───────────────────────────────────────────────────────────── */

import {
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import {
  Body,
  Button,
  Card,
  CenteredSpinner,
  Notice,
  Screen,
  Title,
} from "../components/ui"

import { APP_VERSION, BUILD_NUMBER } from "../config"

import { useAuth } from "../store/AuthContext"

import { colors, fontSize, spacing } from "../theme"

/** Where a blocked user is sent instead. The web storefront reads the
 *  same database, so every purchase remains readable there. */

const WEB_STORE_URL = "https://casanova.example/dashboard/library"

export function GateScreen() {
  const { phase, blockReason, settings, refresh } = useAuth()

  if (phase === "booting") {
    return (
      <Screen>
        <CenteredSpinner label="בודק את תקינות האפליקציה מול השרת…" />
      </Screen>
    )
  }

  if (phase !== "blocked" || !blockReason) return null

  const isUpdate = blockReason.includes("גרסה")

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.badge}>
          <Text style={styles.badgeGlyph}>⛨</Text>
        </View>

        <Title size="xl">
          {isUpdate ? "נדרש עדכון גרסה" : "האפליקציה אינה זמינה"}
        </Title>
        <Body muted>{blockReason}</Body>

        <Card style={styles.card}>
          <Body>
            הספרים שלכם לא נמחקו. הם שמורים בחשבון שלכם וזמינים לקריאה דרך האתר,
            עם אותה מדיניות הגנה ואותם מכשירים מורשים.
          </Body>
        </Card>

        {isUpdate ? (
          <Notice tone="info" title="למה זה קורה">
            גרסאות ישנות של האפליקציה אינן כוללות תיקוני אבטחה של מנגנון ההגנה.
            השרת מסרב לגרסה {BUILD_NUMBER}
            ומטה, וההחלטה הזו מתקבלת לפני שמוצג לכם תוכן כלשהו.
          </Notice>
        ) : null}

        <Button
          label={isUpdate ? "לעדכון האפליקציה" : "פתיחת הספרייה באתר"}
          onPress={() => {
            const url =
              isUpdate && Platform.OS === "ios"
                ? "itms-apps://apps.apple.com/app/casanova-reader"
                : isUpdate
                  ? "market://details?id=com.casanova.reader"
                  : WEB_STORE_URL

            void Linking.openURL(url).catch(() => undefined)
          }}
        />

        <View style={styles.gap} />
        <Button
          label="בדיקה מחדש"
          variant="ghost"
          onPress={() => void refresh()}
        />

        <Text style={styles.version}>
          {settings.brand_name} · גרסה {APP_VERSION} ({BUILD_NUMBER})
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, flexGrow: 1, justifyContent: "center" },

  badge: {
    width: 64,

    height: 64,

    borderRadius: 32,

    backgroundColor: colors.surfaceRaised,

    alignItems: "center",

    justifyContent: "center",

    marginBottom: spacing.lg,

    alignSelf: "flex-start",
  },

  badgeGlyph: { color: colors.primary, fontSize: 28 },

  card: { marginTop: spacing.md },

  gap: { height: spacing.sm },

  version: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textAlign: "center",
    marginTop: spacing.xl,
  },
})

export default GateScreen
