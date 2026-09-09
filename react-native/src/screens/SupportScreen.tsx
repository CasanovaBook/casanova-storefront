/* ─────────────────────────────────────────────────────────────
 * SupportScreen.
 *
 * Writes to the same `inquiries` table as the website's contact form.
 * The `source` column is set to `MOBILE_APP` by the server from the
 * client header rather than sent from here: a value the app chooses is a
 * value the app can forge, and the CMS filters and reports on it.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import {
  Body,
  Button,
  Card,
  Notice,
  Screen,
  TextField,
  Title,
} from "../components/ui"

import { submitInquiry, type InquiryInput } from "../net/api"

import { useAuth } from "../store/AuthContext"

import { useLibrary } from "../store/LibraryContext"

import { colors, fontSize, radius, spacing } from "../theme"

const TOPICS: { value: InquiryInput["topic"], label: string }[] = [
  { value: "ACCESS", label: "גישה לספר" },

  { value: "TECHNICAL", label: "תקלה טכנית" },

  { value: "ORDER", label: "הזמנה" },

  { value: "REFUND", label: "החזר כספי" },

  { value: "BILLING", label: "חיוב וחשבוניות" },

  { value: "GENERAL", label: "פנייה כללית" },
]

export function SupportScreen() {
  const { user, settings } = useAuth()

  const { orders, readable } = useLibrary()

  const [topic, setTopic] = useState<InquiryInput["topic"]>("ACCESS")

  const [subject, setSubject] = useState("")

  const [message, setMessage] = useState("")

  const [phone, setPhone] = useState(user?.phone ?? "")

  const [orderId, setOrderId] = useState<string | undefined>(undefined)

  const [busy, setBusy] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [reference, setReference] = useState<string | null>(null)

  const submit = async () => {
    if (!subject.trim() || !message.trim()) {
      setError("יש למלא נושא ופירוט לפני השליחה.")

      return
    }

    setBusy(true)

    setError(null)

    const result = await submitInquiry({
      topic,

      subject: subject.trim(),

      message: message.trim(),

      customer_phone: phone.trim() || undefined,

      related_order_id: orderId,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setReference(result.data.reference)

    setSubject("")

    setMessage("")

    setOrderId(undefined)
  }

  if (reference) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Title size="lg">הפנייה התקבלה</Title>
          <Notice tone="success" title={`מספר פנייה ${reference}`}>
            הפנייה נרשמה במערכת התמיכה ומופיעה לצוות כפנייה מהאפליקציה. מענה
            יישלח לכתובת {user?.email ?? "שלכם"}.
          </Notice>
          <Button
            label="פנייה נוספת"
            variant="ghost"
            onPress={() => setReference(null)}
          />
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Title size="lg">תמיכה</Title>
          <Body muted>
            כל פנייה נפתחת כרשומה במערכת התמיכה של האתר, עם היסטוריית ההזמנות
            והמכשירים שלכם כבר מצורפת אליה.
          </Body>

          <Card style={styles.context}>
            <Text style={styles.contextTitle}>מצורף לפנייה אוטומטית</Text>
            <Text style={styles.contextLine}>חשבון: {user?.email ?? "—"}</Text>
            <Text style={styles.contextLine}>
              ספרים פעילים: {readable.length}
            </Text>
            <Text style={styles.contextLine}>הזמנות: {orders.length}</Text>
            <Text style={styles.contextLine}>
              מכשיר: {CLIENT_LABEL} · גרסה{" "}
              {settings.mobile_min_build > 0 ? "נתמכת" : "נוכחית"}
            </Text>
          </Card>

          <Text style={styles.label}>נושא הפנייה</Text>
          <View style={styles.topics}>
            {TOPICS.map((item) => {
              const selected = item.value === topic

              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setTopic(item.value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>

          {orders.length > 0 ? (
            <View style={styles.orderPicker}>
              <Text style={styles.label}>הזמנה קשורה (לא חובה)</Text>
              <View style={styles.topics}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: !orderId }}
                  onPress={() => setOrderId(undefined)}
                  style={[styles.chip, !orderId && styles.chipSelected]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      !orderId && styles.chipTextSelected,
                    ]}
                  >
                    ללא
                  </Text>
                </Pressable>
                {orders.slice(0, 6).map((order) => {
                  const selected = orderId === order.order_id

                  return (
                    <Pressable
                      key={order.order_id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setOrderId(order.order_id)}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {order.order_number}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}

          <TextField
            label="נושא"
            value={subject}
            onChangeText={setSubject}
            placeholder="למשל: הספר לא נפתח באפליקציה"
            editable={!busy}
          />
          <TextField
            label="פירוט"
            value={message}
            onChangeText={setMessage}
            placeholder="תארו מה קרה, באיזה מכשיר ובאיזו שעה"
            multiline
            numberOfLines={5}
            style={styles.messageField}
            editable={!busy}
          />
          <TextField
            label="טלפון (לא חובה)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="050-0000000"
            editable={!busy}
          />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Button
            label="שליחת הפנייה"
            onPress={() => void submit()}
            loading={busy}
          />

          {settings.support_email ? (
            <Body muted style={styles.direct}>
              ניתן גם לפנות ישירות אל {settings.support_email}
            </Body>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const CLIENT_LABEL = Platform.OS === "ios" ? "iOS" : "אנדרואיד"

const styles = StyleSheet.create({
  flex: { flex: 1 },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  context: { marginTop: spacing.md },

  contextTitle: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "700",
    marginBottom: spacing.xs,
    writingDirection: "rtl",
  },

  contextLine: {
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 18,
    writingDirection: "rtl",
  },

  label: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    writingDirection: "rtl",
  },

  topics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },

  chip: {
    borderWidth: 1,

    borderColor: colors.border,

    borderRadius: radius.pill,

    paddingHorizontal: spacing.md,

    paddingVertical: spacing.sm,

    backgroundColor: colors.surface,
  },

  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  chipText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    writingDirection: "rtl",
  },

  chipTextSelected: { color: colors.primaryForeground, fontWeight: "700" },

  orderPicker: { marginBottom: spacing.sm },

  messageField: {
    minHeight: 110,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },

  direct: { marginTop: spacing.md, textAlign: "center" },
})

export default SupportScreen
