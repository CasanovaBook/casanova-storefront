/* ─────────────────────────────────────────────────────────────
 * LoginScreen.
 *
 * Signing in here does two things at once: it authenticates against the
 * same `users` table the website uses, and it claims a device slot. The
 * second part is why the screen tells the user up front how many devices
 * their account allows — arriving at the cap after typing a password
 * reads like a broken login rather than a policy.
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

import type { RootStackParamList } from "../navigation/routes"

import { useAuth } from "../store/AuthContext"

import { colors, fontSize, spacing } from "../theme"

type Props = NativeStackScreenProps<RootStackParamList, "Login">

export function LoginScreen({ navigation }: Props) {
  const { signIn, settings } = useAuth()

  const [email, setEmail] = useState("")

  const [password, setPassword] = useState("")

  const [busy, setBusy] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("יש להזין כתובת דוא״ל וסיסמה.")

      return
    }

    setBusy(true)

    setError(null)

    const result = await signIn(email, password)

    setBusy(false)

    if (!result.ok) {
      /* The server's Hebrew message is shown as-is: it already explains
       * suspended accounts, missing passwords and wrong credentials, and
       * duplicating that copy here would let the two drift apart. */

      setError(result.error)
    }
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
          <Text style={styles.brand}>{settings.brand_name}</Text>
          <Title size="xl">הספרייה שלכם</Title>
          <Body muted>
            התחברו עם אותו חשבון שבו אתם משתמשים באתר. הספרים, המכשירים
            וההתקדמות משותפים לשניהם.
          </Body>

          <View style={styles.form}>
            <TextField
              label="דוא״ל"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              /* `textContentType` is what lets a password manager fill
               * both fields. Refusing autofill on a login screen does not
               * protect anything — the credential never touches this app's
               * storage — and it makes signing in on a phone needlessly
               * slow. */

              textContentType="emailAddress"
              placeholder="you@example.com"
              editable={!busy}
            />
            <TextField
              label="סיסמה"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              placeholder="••••••••"
              editable={!busy}
              onSubmitEditing={() => void submit()}
              returnKeyType="go"
            />

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <Button
              label="התחברות"
              onPress={() => void submit()}
              loading={busy}
            />

            <Pressable
              accessibilityRole="link"
              onPress={() => navigation.navigate("ForgotPassword")}
              style={styles.linkRow}
              disabled={busy}
            >
              <Text style={styles.link}>שכחתם סיסמה?</Text>
            </Pressable>
          </View>

          <Card>
            <Body muted>
              ההתחברות רושמת את המכשיר הזה כמכשיר מורשה בחשבון שלכם. מספר
              המכשירים מוגבל על ידי מדיניות ההגנה, וניתן לנהל אותם בכל רגע ממסך
              המכשירים.
            </Body>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  scroll: { padding: spacing.xl, flexGrow: 1, justifyContent: "center" },

  brand: {
    color: colors.primary,

    fontSize: fontSize.sm,

    fontWeight: "700",

    letterSpacing: 2,

    marginBottom: spacing.sm,

    writingDirection: "rtl",
  },

  form: { marginTop: spacing.xl, marginBottom: spacing.lg },

  linkRow: { alignItems: "center", paddingVertical: spacing.md },

  link: { color: colors.primary, fontSize: fontSize.sm, fontWeight: "600" },
})

export default LoginScreen
