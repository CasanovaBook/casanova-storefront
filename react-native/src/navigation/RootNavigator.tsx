/* ─────────────────────────────────────────────────────────────
 * RootNavigator.
 *
 * The screen set is chosen from the auth phase rather than by
 * imperative navigation, so there is no way to end up with a reader
 * mounted above a signed-out state: when the session dies the whole
 * authenticated stack is unmounted, which also unmounts the reader and
 * triggers its vault cleanup.
 * ───────────────────────────────────────────────────────────── */

import { StyleSheet, Text } from "react-native"

import {
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native"

import { createNativeStackNavigator } from "@react-navigation/native-stack"

import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"

import type { HomeTabParamList, RootStackParamList } from "./routes"

import { DashboardScreen } from "../screens/DashboardScreen"

import { DevicesScreen } from "../screens/DevicesScreen"

import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen"

import { GateScreen } from "../screens/GateScreen"

import { LibraryScreen } from "../screens/LibraryScreen"

import { LoginScreen } from "../screens/LoginScreen"

import { ReaderScreen } from "../screens/ReaderScreen"

import { StoreScreen } from "../screens/StoreScreen"

import { SupportScreen } from "../screens/SupportScreen"

import { useAuth } from "../store/AuthContext"

import { colors, fontSize } from "../theme"

const Stack = createNativeStackNavigator<RootStackParamList>()

const Tabs = createBottomTabNavigator<HomeTabParamList>()

/**
 * Navigation theme derived from the app palette.
 *
 * Overriding `colors.background` matters for a specific reason: the
 * native stack paints the area behind a transitioning screen with the
 * theme background. Leaving it white would flash the reader's black
 * background to white on every push, and a screen recording started
 * before the flash captures a readable frame of the outgoing screen.
 */

/* A module-level constant rather than a `useMemo` inside the component:
 * nothing here depends on props or state, so rebuilding it on every render
 * would only churn the object identity `NavigationContainer` compares. */

const navigationTheme: Theme = {
  ...DefaultTheme,

  colors: {
    ...DefaultTheme.colors,

    primary: colors.primary,

    background: colors.background,

    card: colors.surface,

    text: colors.foreground,

    border: colors.border,

    notification: colors.primary,
  },
}

const TAB_ICONS: Record<keyof HomeTabParamList, string> = {
  Library: "❦",

  Store: "⌂",

  Dashboard: "☰",

  Support: "✉",
}

function HomeTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,

        tabBarActiveTintColor: colors.primary,

        tabBarInactiveTintColor: colors.muted,

        tabBarStyle: styles.tabBar,

        tabBarLabelStyle: styles.tabLabel,

        sceneStyle: styles.tabScene,

        tabBarIcon: ({ color, size }) => (
          <Text style={[styles.tabIcon, { color, fontSize: size ?? 18 }]}>
            {TAB_ICONS[route.name]}
          </Text>
        ),
      })}
    >
      <Tabs.Screen
        name="Library"
        component={LibraryScreen}
        options={{ title: "הספרייה" }}
      />
      <Tabs.Screen
        name="Store"
        component={StoreScreen}
        options={{ title: "החנות" }}
      />
      <Tabs.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ title: "החשבון" }}
      />
      <Tabs.Screen
        name="Support"
        component={SupportScreen}
        options={{ title: "תמיכה" }}
      />
    </Tabs.Navigator>
  )
}

export function RootNavigator() {
  const { phase } = useAuth()

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {phase === "signed-in" ? (
          <>
            <Stack.Screen name="Home" component={HomeTabs} />
            <Stack.Screen
              name="Reader"
              component={ReaderScreen}
              options={{
                /* A fade rather than the platform slide: the iOS
                 * interactive swipe-back gesture replays frames of the
                 * outgoing screen during the transition, and a fade has
                 * no such replay. */

                animation: "fade",

                gestureEnabled: false,
              }}
            />
            <Stack.Screen
              name="Devices"
              component={DevicesScreen}
              options={{
                animation: "slide_from_right",
                headerShown: true,
                title: "מכשירים",
              }}
            />
          </>
        ) : phase === "signed-out" ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{ animation: "slide_from_right" }}
            />
          </>
        ) : (
          <Stack.Screen
            name="Gate"
            component={GateScreen}
            options={{ animation: "fade" }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,

    borderTopColor: colors.border,

    borderTopWidth: 1,
  },

  tabLabel: { fontSize: fontSize.xs, writingDirection: "rtl" },

  tabScene: { backgroundColor: colors.background },

  tabIcon: { textAlign: "center" },
})

export default RootNavigator
