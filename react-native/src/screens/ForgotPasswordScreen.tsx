/* ─────────────────────────────────────────────────────────────
 * ForgotPasswordScreen.
 *
 * Writes to the same `password_resets` table the website does, so a
 * reset requested from a phone produces a link that works in a browser
 * and vice versa. The app deliberately cannot set a new password: a
 * password change is the one operation that should happen where the
 * email link lands, not on a device whose integrity nobody verified.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { ScrollView, StyleSheet, View } from "react-native"

import type { NativeStackScreenProps } from "@react-navigation/native-stack"

import {
  Body,
  Button,
  Card,
  Notice,
  Screen,
  TextField,
  Title,
} from "../components/ui"

import { requestPasswordReset } from "../net/api"

import type { RootStackParamList } from "../navigation/routes"

import { spacing } from "../theme"

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail] = useState("")

  const [busy, setBusy] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [sent, setSent] = useState(false)

  const submit = async () => {
    if (!email.trim()) {
      setError("יש להזין את כתובת הדוא״ל של החשבון.")

      return
    }

    setBusy(true)

    setError(null)

    const result = await requestPasswordReset(email)

    setBusy(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setSent(true)
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Title size="lg">איפוס סיסמה</Title>
        <Body muted>
          נשלח אליכם קישור לאיפוס. הקישור זהה לזה שנשלח מהאתר, וניתן לפתוח אותו
          בכל מכשיר שבו אתם מחוברים.
        </Body>

        <View style={styles.form}>
          {sent ? (
            <Notice tone="success" title="הבקשה נשלחה">
              בדקו את תיבת הדוא״ל. מטעמי אבטחה האפליקציה אינה מגלה אם קיים חשבון
              בכתובת שהוזנה — אם לא קיבלתם קישור, ודאו שזו הכתובת שבה נרשמתם.
            </Notice>
          ) : (
            <>
              <TextField
                label="דוא״ל"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                textContentType="emailAddress"
                placeholder="you@example.com"
                editable={!busy}
                onSubmitEditing={() => void submit()}
              />
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Button
                label="שליחת קישור איפוס"
                onPress={() => void submit()}
                loading={busy}
              />
            </>
          )}

          <View style={styles.gap} />
          <Button
            label={sent ? "חזרה להתחברות" : "ביטול"}
            variant="ghost"
            onPress={() => navigation.goBack()}
          />
        </View>

        <Card>
          <Body muted>
            איפוס סיסמה אינו מסיר מכשירים מורשים. אם אתם חושדים שמישהו אחר מחובר
            לחשבון, הסירו את המכשיר שלו ממסך המכשירים — הפעולה הזו גם מוחקת את
            כל העותקים המקומיים שלו.
          </Body>
        </Card>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, flexGrow: 1 },

  form: { marginTop: spacing.xl, marginBottom: spacing.lg },

  gap: { height: spacing.sm },
})

export default ForgotPasswordScreen
