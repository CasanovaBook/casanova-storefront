/* ─────────────────────────────────────────────────────────────
 * LibraryScreen — what this account may open on this device.
 *
 * The list comes from `v_entitled_content`, the same view the web
 * dashboard reads, so an entitlement revoked in the CMS disappears from
 * both at the same moment. Rows whose access is not `ACTIVE` are still
 * shown, greyed and unopenable, because a customer who cannot find a book
 * they paid for opens a support ticket; a customer who can see it and
 * read why it is locked does not.
 * ───────────────────────────────────────────────────────────── */

import { useCallback } from "react"

import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { useNavigation } from "@react-navigation/native"

import type { NativeStackNavigationProp } from "@react-navigation/native-stack"

import {
  Body,
  Button,
  Card,
  EmptyState,
  Notice,
  Screen,
  Title,
} from "../components/ui"

import type { RootStackParamList } from "../navigation/routes"

import type { UserProduct } from "../net/types"

import { isEntitlementLive } from "../net/types"

import { useAuth } from "../store/AuthContext"

import { useLibrary } from "../store/LibraryContext"

import { useProtection } from "../store/ProtectionContext"

import { colors, fontSize, radius, spacing } from "../theme"

const ACCESS_LABEL: Record<UserProduct["access_status"], string> = {
  ACTIVE: "פעיל",

  EXPIRED: "פג תוקף",

  REVOKED: "נחסם",

  SUSPENDED: "מושהה",
}

export function LibraryScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const { entitlements, loading, error, reload } = useLibrary()

  const { settings } = useAuth()

  const { policy } = useProtection()

  const onRefresh = useCallback(() => {
    void reload()
  }, [reload])

  const open = useCallback(
    (up: UserProduct, offline: boolean) => {
      navigation.navigate("Reader", {
        productId: up.product_id,

        title: up.product_snapshot.name,

        offline,
      })
    },

    [navigation],
  )

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <Title size="lg">הספרייה שלי</Title>
        <Body muted>
          {entitlements.length > 0
            ? `${entitlements.length} פריטים בחשבון · משותף עם האתר`
            : "הפריטים שלכם יופיעו כאן מיד לאחר הרכישה."}
        </Body>

        {error ? <Notice tone="warn">{error}</Notice> : null}

        {policy.allow_offline ? (
          <Notice tone="info" title="קריאה ללא חיבור מותרת">
            עותק לא מקוון נשמר בכספת הפרטית של האפליקציה ל־
            {policy.offline_ttl_hours ?? 0} שעות ונמחק אוטומטית בתום התוקף. הוא
            אינו מועבר לאפליקציות אחרות ואינו נכלל בגיבוי.
          </Notice>
        ) : null}

        {!loading && entitlements.length === 0 && !error ? (
          <EmptyState
            title="עדיין אין ספרים"
            message="רכישות שבוצעו באתר או באפליקציה יופיעו כאן אוטומטית. אותו חשבון, אותה ספרייה."
            action={
              <Button
                label="לחנות"
                variant="ghost"
                onPress={() => navigation.navigate("Home", { screen: "Store" })}
              />
            }
          />
        ) : null}

        {entitlements.map((up) => {
          const live = isEntitlementLive(up)

          const snapshot = up.product_snapshot

          return (
            <Card
              key={up.user_product_id}
              style={[styles.row, !live && styles.rowLocked]}
            >
              <View style={styles.coverWrap}>
                {snapshot.image_url ? (
                  <Image
                    source={{ uri: snapshot.image_url }}
                    style={styles.cover}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={[
                      styles.cover,

                      styles.coverFallback,

                      {
                        backgroundColor:
                          snapshot.cover_colors?.[0] ?? colors.surfaceRaised,
                      },
                    ]}
                  >
                    <Text style={styles.coverFallbackText}>
                      {snapshot.name.slice(0, 1)}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.rowBody}>
                <Text numberOfLines={2} style={styles.rowTitle}>
                  {snapshot.name}
                </Text>
                {snapshot.author_name ? (
                  <Text numberOfLines={1} style={styles.rowAuthor}>
                    {snapshot.author_name}
                  </Text>
                ) : null}
                <Text style={[styles.rowMeta, !live && styles.rowMetaLocked]}>
                  {live ? ACCESS_LABEL.ACTIVE : ACCESS_LABEL[up.access_status]}
                  {up.expires_at && live
                    ? ` · עד ${new Date(up.expires_at).toLocaleDateString("he-IL")}`
                    : ""}
                </Text>

                {live ? (
                  <View style={styles.actions}>
                    <Button
                      label="קריאה"
                      onPress={() => open(up, false)}
                      style={styles.actionButton}
                    />
                    {policy.allow_offline ? (
                      <Button
                        label="עותק לא מקוון"
                        variant="ghost"
                        onPress={() => open(up, true)}
                        style={styles.actionButton}
                      />
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.lockedHint}>
                    {up.access_status === "REVOKED"
                      ? "הגישה נחסמה על ידי הצוות. פנו לתמיכה לבירור."
                      : up.access_status === "EXPIRED"
                        ? "תוקף הגישה פג. ניתן לחדש אותה דרך התמיכה."
                        : "הגישה מושהית כרגע."}
                  </Text>
                )}
              </View>
            </Card>
          )
        })}

        <Pressable
          accessibilityRole="link"
          style={styles.deviceLink}
          onPress={() => navigation.navigate("Devices")}
        >
          <Text style={styles.deviceLinkText}>ניהול מכשירים מורשים ›</Text>
        </Pressable>

        <Text style={styles.brand}>{settings.brand_name}</Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  row: { flexDirection: "row", gap: spacing.md },

  rowLocked: { opacity: 0.6 },

  coverWrap: { width: 74 },

  cover: {
    width: 74,

    height: 104,

    borderRadius: radius.sm,

    backgroundColor: colors.surfaceRaised,

    overflow: "hidden",
  },

  coverFallback: { alignItems: "center", justifyContent: "center" },

  coverFallbackText: {
    color: colors.foreground,
    fontSize: fontSize.xxl,
    fontWeight: "700",
  },

  rowBody: { flex: 1 },

  rowTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
    writingDirection: "rtl",
  },

  rowAuthor: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 2,
    writingDirection: "rtl",
  },

  rowMeta: {
    color: colors.success,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    writingDirection: "rtl",
  },

  rowMetaLocked: { color: colors.danger },

  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: "wrap",
  },

  actionButton: { paddingHorizontal: spacing.lg },

  lockedHint: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
    lineHeight: 18,
    writingDirection: "rtl",
  },

  deviceLink: { alignItems: "center", paddingVertical: spacing.lg },

  deviceLinkText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },

  brand: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textAlign: "center",
    letterSpacing: 1.5,
  },
})

export default LibraryScreen
