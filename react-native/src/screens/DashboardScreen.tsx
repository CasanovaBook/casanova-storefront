/* ─────────────────────────────────────────────────────────────
 * DashboardScreen — account, orders and the state of local storage.
 *
 * The storage section is not a convenience. A reader who cannot see that
 * a copy is on their phone cannot make an informed decision about
 * lending it, selling it or handing it in for repair, so the app shows
 * the size of its own vault and offers to empty it.
 * ───────────────────────────────────────────────────────────── */

import { useCallback, useState } from "react"

import {
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { useNavigation } from "@react-navigation/native"

import type { NativeStackNavigationProp } from "@react-navigation/native-stack"

import { Body, Button, Card, Notice, Screen, Title } from "../components/ui"

import { APP_VERSION, BUILD_NUMBER, CLIENT } from "../config"

import { destroyAllLocalCopies } from "../drm/useReaderSession"

import {
  PLATFORM_PROTECTION_NOTE,
  isCompromised,
  probeIntegrity,
} from "../drm/ScreenShield"

import type { RootStackParamList } from "../navigation/routes"

import { fullName } from "../net/types"

import type { DeviceIntegrity, Order } from "../net/types"

import { useAuth } from "../store/AuthContext"

import { useLibrary } from "../store/LibraryContext"

import { useProtection } from "../store/ProtectionContext"

import { formatPrice } from "./StoreScreen"

import { colors, fontSize, spacing } from "../theme"

const ORDER_STATUS_LABEL: Record<Order["order_status"], string> = {
  PENDING: "ממתין לתשלום",

  PAID: "שולם",

  CANCELLED: "בוטל",

  REFUNDED: "הוחזר",

  FAILED: "נכשל",
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0"

  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ק״ב`

  return `${(bytes / (1024 * 1024)).toFixed(1)} מ״ב`
}

export function DashboardScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>()

  const { user, settings, signOut } = useAuth()

  const { orders, readable, vaultBytes, devices, loading, reload } =
    useLibrary()

  const { policy, protected: shieldOn, shieldFailed } = useProtection()

  const [integrity, setIntegrity] = useState<DeviceIntegrity>("UNKNOWN")

  const [busy, setBusy] = useState(false)

  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    await Promise.all([reload(), probeIntegrity().then(setIntegrity)])
  }, [reload])

  const clearVault = () => {
    Alert.alert(
      "למחוק את כל העותקים השמורים?",
      "כל קובץ שנשמר במכשיר זה יימחק. הספרים יישארו בחשבון שלכם.",
      [
        { text: "ביטול", style: "cancel" },

        {
          text: "מחיקה",

          style: "destructive",

          onPress: () => {
            setBusy(true)

            void destroyAllLocalCopies()

              .then(() => refresh())

              .then(() => {
                setBusy(false)

                setNotice("כל העותקים המקומיים נמחקו מהמכשיר.")
              })

              .catch(() => {
                setBusy(false)

                setNotice("המחיקה נכשלה. נסו שוב.")
              })
          },
        },
      ],
    )
  }

  const compromised = isCompromised(integrity)

  const activeDevices = devices.filter((d) => !d.revoked).length

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
          />
        }
      >
        <Title size="lg">
          {user ? `שלום, ${user.first_name}` : "החשבון שלי"}
        </Title>
        <Body muted>{user ? fullName(user) + " · " + user.email : ""}</Body>

        {notice ? <Notice tone="success">{notice}</Notice> : null}

        {/* ── Protection ─────────────────────────────── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>הגנה על התוכן</Text>

          <Row
            label="צילום והקלטת מסך"
            value={
              shieldFailed
                ? "ההגנה לא נטענה"
                : shieldOn
                  ? "חסומים"
                  : "מותרים לפי המדיניות"
            }
            tone={shieldFailed ? "danger" : shieldOn ? "ok" : "warn"}
          />
          <Row
            label="הורדה ושיתוף הקובץ"
            value={policy.block_download ? "חסומים" : "מותרים"}
            tone={policy.block_download ? "ok" : "warn"}
          />
          <Row
            label="קריאה ללא חיבור"
            value={
              policy.allow_offline
                ? `מותרת ל־${policy.offline_ttl_hours ?? 0} שעות`
                : "אסורה"
            }
          />
          <Row
            label="סימון אישי על העמודים"
            value={policy.watermark_enabled ? "פעיל" : "כבוי"}
          />
          <Row
            label="מכשירים מורשים"
            value={`${activeDevices} / ${policy.max_devices_per_user}`}
          />
          <Row
            label="תקינות המכשיר"
            value={
              compromised
                ? "המכשיר אינו עומד בדרישות"
                : integrity === "TRUSTED"
                  ? "תקין"
                  : "לא נבדק"
            }
            tone={compromised ? "danger" : "ok"}
          />

          {compromised ? (
            <Notice tone="danger" title="קריאה תיחסם במכשיר זה">
              מדיניות ההגנה אוסרת קריאה בתוכן מוגן במכשיר פרוץ או מדומה. הספרים
              שלכם זמינים דרך האתר.
            </Notice>
          ) : null}

          <Body muted style={styles.note}>
            {PLATFORM_PROTECTION_NOTE}
          </Body>
        </Card>

        {/* ── Local storage ──────────────────────────── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>אחסון במכשיר</Text>
          <Row
            label="עותקים שמורים"
            value={vaultBytes > 0 ? formatBytes(vaultBytes) : "אין"}
          />
          <Row label="ספרים זמינים לקריאה" value={String(readable.length)} />
          <Body muted style={styles.note}>
            הקבצים שמורים בכספת הפרטית של האפליקציה בלבד, אינם נגישים לאפליקציות
            אחרות, אינם נכללים בגיבוי המכשיר ונמחקים אוטומטית בתום התוקף, בניתוק
            או בהסרת המכשיר.
          </Body>
          <Button
            label="מחיקת כל העותקים מהמכשיר"
            variant="danger"
            style={styles.sectionButton}
            loading={busy}
            onPress={clearVault}
          />
        </Card>

        {/* ── Orders ─────────────────────────────────── */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>היסטוריית הזמנות</Text>
          {orders.length === 0 ? (
            <Body muted>אין עדיין הזמנות בחשבון.</Body>
          ) : (
            orders.slice(0, 10).map((order) => (
              <View key={order.order_id} style={styles.orderRow}>
                <View style={styles.orderMain}>
                  <Text style={styles.orderNumber}>{order.order_number}</Text>
                  <Text style={styles.orderMeta}>
                    {new Date(order.created_at).toLocaleDateString("he-IL")} ·{" "}
                    {ORDER_STATUS_LABEL[order.order_status]}
                  </Text>
                </View>
                <Text style={styles.orderAmount}>
                  {formatPrice(
                    order.total_amount,
                    order.currency || settings.default_currency,
                  )}
                </Text>
              </View>
            ))
          )}
        </Card>

        {/* ── Actions ────────────────────────────────── */}
        <Button
          label="ניהול מכשירים"
          variant="ghost"
          onPress={() => navigation.navigate("Devices")}
        />
        <View style={styles.gap} />
        <Button
          label="פתיחת הספרייה באתר"
          variant="ghost"
          onPress={() =>
            void Linking.openURL(
              "https://casanova.example/dashboard/library",
            ).catch(() => undefined)
          }
        />
        <View style={styles.gap} />
        <Button
          label="התנתקות"
          variant="danger"
          onPress={() =>
            Alert.alert("להתנתק?", "ההתנתקות מוחקת כל עותק שמור במכשיר זה.", [
              { text: "ביטול", style: "cancel" },

              {
                text: "התנתקות",
                style: "destructive",
                onPress: () => void signOut(),
              },
            ])
          }
        />

        <Text style={styles.version}>
          {settings.brand_name} · {CLIENT === "IOS" ? "iOS" : "Android"} · גרסה{" "}
          {APP_VERSION} ({BUILD_NUMBER})
        </Text>
      </ScrollView>
    </Screen>
  )
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "ok" | "warn" | "danger" | "neutral"
}) {
  const color =
    tone === "danger"
      ? colors.danger
      : tone === "warn"
        ? colors.primary
        : tone === "ok"
          ? colors.success
          : colors.foreground

  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, { color }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  section: { marginTop: spacing.md },

  sectionTitle: {
    color: colors.primary,

    fontSize: fontSize.sm,

    fontWeight: "700",

    letterSpacing: 0.6,

    marginBottom: spacing.sm,

    writingDirection: "rtl",
  },

  sectionButton: { marginTop: spacing.md },

  row: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "center",

    paddingVertical: 6,

    gap: spacing.md,
  },

  rowLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: fontSize.sm,
    writingDirection: "rtl",
  },

  rowValue: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: "600",
    textAlign: "left",
    writingDirection: "rtl",
  },

  note: { marginTop: spacing.sm },

  gap: { height: spacing.sm },

  orderRow: {
    flexDirection: "row",

    justifyContent: "space-between",

    alignItems: "center",

    paddingVertical: spacing.sm,

    borderBottomWidth: 1,

    borderBottomColor: colors.border,

    gap: spacing.md,
  },

  orderMain: { flex: 1 },

  orderNumber: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "600",
    writingDirection: "rtl",
  },

  orderMeta: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: 2,
    writingDirection: "rtl",
  },

  orderAmount: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },

  version: {
    color: colors.muted,
    fontSize: fontSize.xs,
    textAlign: "center",
    marginTop: spacing.xl,
  },
})

export default DashboardScreen
