/* ─────────────────────────────────────────────────────────────
 * DevicesScreen — the customer's own device management.
 *
 * Same `device_sessions` rows the CMS security screen shows, with one
 * difference in what can be done to them: a customer may remove a device
 * but may not see another account's, and removal here cascades exactly as
 * it does in the CMS — `trg_device_session_revokes_grants` kills every
 * content grant issued to that session, so a phone removed from the list
 * stops being able to read immediately rather than at the next refresh.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { Alert, ScrollView, StyleSheet, Text, View } from "react-native"

import {
  Body,
  Button,
  Card,
  EmptyState,
  Notice,
  Screen,
  Title,
} from "../components/ui"

import type { DeviceIntegrity, DeviceSession } from "../net/types"

import { useLibrary } from "../store/LibraryContext"

import { useProtection } from "../store/ProtectionContext"

import { colors, fontSize, spacing } from "../theme"

const INTEGRITY_LABEL: Record<DeviceIntegrity, {
  text: string
  tone: "ok" | "warn" | "danger"
}> = {
  UNKNOWN: { text: "לא נבדק", tone: "warn" },

  TRUSTED: { text: "מכשיר תקין", tone: "ok" },

  ROOTED: { text: "מכשיר עם root", tone: "danger" },

  JAILBROKEN: { text: "מכשיר עם jailbreak", tone: "danger" },

  ATTESTATION_FAILED: { text: "אימות מכשיר נכשל", tone: "danger" },

  EMULATOR: { text: "מדמה", tone: "danger" },
}

const PLATFORM_LABEL: Record<DeviceSession["platform"], string> = {
  WEB: "דפדפן",

  ANDROID: "אנדרואיד",

  IOS: "iOS",
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()

  if (Number.isNaN(then)) return iso

  const minutes = Math.round((Date.now() - then) / 60_000)

  if (minutes < 1) return "עכשיו"

  if (minutes < 60) return `לפני ${minutes} דקות`

  const hours = Math.round(minutes / 60)

  if (hours < 24) return `לפני ${hours} שעות`

  const days = Math.round(hours / 24)

  return `לפני ${days} ימים`
}

export function DevicesScreen() {
  const { devices, loading, error, removeDevice, reload } = useLibrary()

  const { policy } = useProtection()

  const [busyId, setBusyId] = useState<string | null>(null)

  const [notice, setNotice] = useState<string | null>(null)

  const confirmRemove = (device: DeviceSession) => {
    if (device.current) {
      /* Removing the device you are reading on would cut this screen off
       * mid-book and destroy its local copy. It is allowed, but not by
       * accident. */

      Alert.alert(
        "להסיר את המכשיר הזה?",

        "זהו המכשיר שבו אתם משתמשים כרגע. ההסרה תנתק את הקריאה מיידית ותמחק כל עותק שמור במכשיר זה.",

        [
          { text: "ביטול", style: "cancel" },

          {
            text: "הסרה",
            style: "destructive",
            onPress: () => void remove(device),
          },
        ],
      )

      return
    }

    Alert.alert(
      "להסיר את המכשיר?",
      `${device.device_name} ינותק ולא יוכל לקרוא עד להתחברות מחדש.`,
      [
        { text: "ביטול", style: "cancel" },

        {
          text: "הסרה",
          style: "destructive",
          onPress: () => void remove(device),
        },
      ],
    )
  }

  const remove = async (device: DeviceSession) => {
    setBusyId(device.session_id)

    setNotice(null)

    const failure = await removeDevice(device.session_id)

    setBusyId(null)

    setNotice(failure ?? "המכשיר הוסר. כל אישורי הקריאה שלו בוטלו מיידית.")
  }

  const active = devices.filter((d) => !d.revoked)

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Title size="lg">מכשירים מורשים</Title>
        <Body muted>
          {active.length} מתוך {policy.max_devices_per_user} מכשירים פעילים.
          המגבלה נקבעת על ידי מדיניות ההגנה וחלה על האתר ועל האפליקציה יחד.
        </Body>

        {notice ? <Notice tone="info">{notice}</Notice> : null}
        {error ? <Notice tone="warn">{error}</Notice> : null}

        {!loading && devices.length === 0 ? (
          <EmptyState
            title="אין מכשירים רשומים"
            message="מכשיר נרשם בפעם הראשונה שפותחים בה ספר לקריאה."
          />
        ) : null}

        {devices.map((device) => {
          const integrity =
            INTEGRITY_LABEL[device.device_integrity] ?? INTEGRITY_LABEL.UNKNOWN

          const toneColor =
            integrity.tone === "danger"
              ? colors.danger
              : integrity.tone === "warn"
                ? colors.primary
                : colors.success

          return (
            <Card
              key={device.session_id}
              style={[styles.row, device.revoked && styles.rowRevoked]}
            >
              <View style={styles.rowHeader}>
                <Text style={styles.deviceName} numberOfLines={1}>
                  {device.device_name || "מכשיר לא מזוהה"}
                </Text>
                {device.current ? (
                  <Text style={styles.currentBadge}>המכשיר הזה</Text>
                ) : null}
              </View>

              <Text style={styles.meta}>
                {PLATFORM_LABEL[device.platform]}
                {device.os_version ? ` · ${device.os_version}` : ""}
                {device.app_version ? ` · גרסה ${device.app_version}` : ""}
              </Text>
              <Text style={styles.meta}>
                פעילות אחרונה: {relativeTime(device.last_seen_at)}
              </Text>
              <Text style={[styles.meta, { color: toneColor }]}>
                {integrity.text}
              </Text>

              {!device.secure_flag_active && !device.revoked ? (
                <Text style={[styles.meta, { color: colors.danger }]}>
                  שכבת ההגנה לא פעילה במכשיר זה — קריאה בתוכן מוגן תיחסם בו.
                </Text>
              ) : null}

              {device.revoked ? (
                <View style={styles.revokedBox}>
                  <Text style={styles.revokedTitle}>נותק</Text>
                  <Text style={styles.meta}>
                    {device.revoked_by ? `על ידי ${device.revoked_by}` : ""}
                    {device.revoked_at
                      ? ` · ${relativeTime(device.revoked_at)}`
                      : ""}
                  </Text>
                  {device.revoke_reason ? (
                    <Text style={styles.meta}>{device.revoke_reason}</Text>
                  ) : null}
                </View>
              ) : (
                <Button
                  label={device.current ? "הסרת המכשיר הזה" : "הסרה"}
                  variant="danger"
                  style={styles.removeButton}
                  loading={busyId === device.session_id}
                  onPress={() => confirmRemove(device)}
                />
              )}
            </Card>
          )
        })}

        <Button
          label="רענון"
          variant="ghost"
          onPress={() => void reload()}
          loading={loading}
        />

        <Card style={styles.note}>
          <Body muted>
            הסרת מכשיר מוחקת גם את כל העותקים השמורים בו. אם איבדתם טלפון, הסירו
            אותו כאן מיד — זו הפעולה היחידה שעוצרת קריאה במכשיר שכבר לא בידיים
            שלכם.
          </Body>
        </Card>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  row: { gap: 2 },

  rowRevoked: { opacity: 0.65 },

  rowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  deviceName: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
    writingDirection: "rtl",
  },

  currentBadge: {
    color: colors.primaryForeground,

    backgroundColor: colors.primary,

    fontSize: fontSize.xs,

    fontWeight: "700",

    paddingHorizontal: spacing.sm,

    paddingVertical: 2,

    borderRadius: 999,

    overflow: "hidden",
  },

  meta: {
    color: colors.muted,
    fontSize: fontSize.xs,
    writingDirection: "rtl",
    lineHeight: 17,
  },

  revokedBox: { marginTop: spacing.sm },

  revokedTitle: {
    color: colors.danger,
    fontSize: fontSize.sm,
    fontWeight: "700",
    writingDirection: "rtl",
  },

  removeButton: { marginTop: spacing.md, alignSelf: "flex-start" },

  note: { marginTop: spacing.lg },
})

export default DevicesScreen
