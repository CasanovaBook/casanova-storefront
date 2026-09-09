/* ─────────────────────────────────────────────────────────────
 * Shared UI primitives.
 *
 * One file rather than one per component: these are small, they share
 * the same tokens, and a reviewer checking that the app is consistently
 * RTL gets that from reading one file top to bottom.
 *
 * Every layout uses logical properties (`marginStart`, `paddingEnd`)
 * rather than physical ones (`marginLeft`, `paddingRight`). With
 * `I18nManager.forceRTL(true)` the logical forms flip correctly and the
 * physical ones do not, which is how a Hebrew app ends up with its
 * back button on the wrong side.
 * ───────────────────────────────────────────────────────────── */

import type { ReactNode } from "react"

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { SafeAreaView } from "react-native-safe-area-context"

import { colors, fontSize, radius, spacing, TAP_TARGET } from "../theme"

/* ── Screen shell ───────────────────────────────────────── */

export function Screen({
  children,

  style,

  edges = ["top", "left", "right"],
}: {
  children: ReactNode

  style?: StyleProp<ViewStyle>

  edges?: ("top" | "bottom" | "left" | "right")[]
}) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  )
}

/* ── Typography ─────────────────────────────────────────── */

export function Title({
  children,
  size = "lg",
}: {
  children: ReactNode
  size?: "md" | "lg" | "xl"
}) {
  const map = { md: fontSize.lg, lg: fontSize.xl, xl: fontSize.xxl } as const

  return <Text style={[styles.title, { fontSize: map[size] }]}>{children}</Text>
}

export function Body({
  children,
  muted = false,
  style,
}: {
  children: ReactNode
  muted?: boolean
  style?: StyleProp<TextStyle>
}) {
  return (
    <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>
  )
}

/* ── Buttons ────────────────────────────────────────────── */

export type ButtonVariant = "primary" | "ghost" | "danger"

export function Button({
  label,

  onPress,

  variant = "primary",

  loading = false,

  disabled = false,

  style,
}: {
  label: string

  onPress: () => void

  variant?: ButtonVariant

  loading?: boolean

  disabled?: boolean

  style?: StyleProp<ViewStyle>
}) {
  const blocked = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      onPress={blocked ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,

        variant === "primary" && styles.buttonPrimary,

        variant === "ghost" && styles.buttonGhost,

        variant === "danger" && styles.buttonDanger,

        pressed && !blocked && styles.buttonPressed,

        blocked && styles.buttonDisabled,

        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === "primary" ? colors.primaryForeground : colors.primary
          }
        />
      ) : (
        <Text
          style={[
            styles.buttonLabel,

            variant === "primary" && styles.buttonLabelPrimary,

            variant === "danger" && styles.buttonLabelDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

/* ── Inputs ─────────────────────────────────────────────── */

export function TextField({
  label,

  error,

  hint,

  ...input
}: TextInputProps & { label: string, error?: string | null, hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? styles.inputError : null]}
        /* Hebrew input in an RTL app: without this the caret sits on the
         * wrong side of a mixed Hebrew/English string such as an email. */

        textAlign="right"
        writingDirection="rtl"
        {...input}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  )
}

/* ── Surfaces ───────────────────────────────────────────── */

export function Card({
  children,
  style,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return <View style={[styles.card, style]}>{children}</View>
}

export type NoticeTone = "info" | "warn" | "danger" | "success"

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: NoticeTone
  title?: string
  children: ReactNode
}) {
  const accent =
    tone === "danger"
      ? colors.danger
      : tone === "success"
        ? colors.success
        : tone === "warn"
          ? colors.primary
          : colors.border

  return (
    <View style={[styles.notice, { borderStartColor: accent }]}>
      {title ? (
        <Text style={[styles.noticeTitle, { color: accent }]}>{title}</Text>
      ) : null}
      <Text style={styles.noticeBody}>{children}</Text>
    </View>
  )
}

export function ProgressBar({
  value,
  label,
}: {
  value: number
  label?: string
}) {
  const clamped = Math.max(0, Math.min(1, value))

  return (
    <View style={styles.progressWrap}>
      {label ? <Text style={styles.muted}>{label}</Text> : null}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(clamped * 100)}%` },
          ]}
        />
      </View>
    </View>
  )
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action}
    </View>
  )
}

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <View style={styles.spinner}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <Text style={[styles.muted, styles.spinnerLabel]}>{label}</Text>
      ) : null}
    </View>
  )
}

/* ── Styles ─────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  title: {
    color: colors.foreground,
    fontWeight: "700",
    marginBottom: spacing.sm,
    writingDirection: "rtl",
  },

  body: {
    color: colors.foreground,
    fontSize: fontSize.md,
    lineHeight: 22,
    writingDirection: "rtl",
  },

  muted: {
    color: colors.muted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    writingDirection: "rtl",
  },

  button: {
    minHeight: TAP_TARGET,

    borderRadius: radius.md,

    alignItems: "center",

    justifyContent: "center",

    paddingHorizontal: spacing.lg,

    flexDirection: "row",
  },

  buttonPrimary: { backgroundColor: colors.primary },

  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },

  buttonDanger: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.danger,
  },

  buttonPressed: { opacity: 0.85 },

  buttonDisabled: { opacity: 0.45 },

  buttonLabel: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },

  buttonLabelPrimary: { color: colors.primaryForeground },

  buttonLabelDanger: { color: colors.danger },

  field: { marginBottom: spacing.lg },

  fieldLabel: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
    writingDirection: "rtl",
  },

  input: {
    minHeight: TAP_TARGET,

    borderWidth: 1,

    borderColor: colors.border,

    borderRadius: radius.md,

    backgroundColor: colors.surface,

    color: colors.foreground,

    paddingHorizontal: spacing.md,

    fontSize: fontSize.md,
  },

  inputError: { borderColor: colors.danger },

  fieldError: {
    color: colors.danger,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    writingDirection: "rtl",
  },

  fieldHint: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    writingDirection: "rtl",
  },

  card: {
    backgroundColor: colors.surface,

    borderWidth: 1,

    borderColor: colors.border,

    borderRadius: radius.lg,

    padding: spacing.lg,

    marginBottom: spacing.md,
  },

  notice: {
    borderStartWidth: 3,

    backgroundColor: colors.surfaceRaised,

    borderRadius: radius.md,

    padding: spacing.md,

    marginBottom: spacing.md,
  },

  noticeTitle: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    marginBottom: spacing.xs,
    writingDirection: "rtl",
  },

  noticeBody: {
    color: colors.foreground,
    fontSize: fontSize.sm,
    lineHeight: 20,
    writingDirection: "rtl",
  },

  progressWrap: { marginBottom: spacing.md },

  progressTrack: {
    height: 6,

    borderRadius: radius.pill,

    backgroundColor: colors.surfaceRaised,

    overflow: "hidden",

    marginTop: spacing.xs,
  },

  progressFill: { height: 6, backgroundColor: colors.primary },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
  },

  emptyTitle: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
    marginBottom: spacing.sm,
    textAlign: "center",
  },

  emptyMessage: {
    color: colors.muted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: spacing.lg,
  },

  spinner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },

  spinnerLabel: { marginTop: spacing.md, textAlign: "center" },
})
