# ProGuard / R8 rules.
#
# These are written and kept even though `minifyEnabled` is false in
# app/build.gradle. The reason is in that file: turning R8 on without being
# able to run the resulting build would ship an app that fails when it opens a
# book. The rules are here so that when someone does turn it on, the work is
# already done and the only remaining step is verification on a real device.
#
# Order matters for readability, not for correctness: R8 applies all rules.

# ── React Native ───────────────────────────────────────────
# Keep the classes the bridge reaches by name. Every @ReactMethod is invoked
# through reflection on the module name, so an obfuscated module name means the
# JavaScript side resolves `NativeModules.ScreenShield` to undefined — which in
# this app presents as "protection unavailable" rather than as a crash, and is
# therefore very easy to ship by accident.
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.soloader.** { *; }
-keepclassmembers class * extends com.facebook.react.bridge.NativeModule {
    public <init>(...);
}

# ── This app's DRM layer ───────────────────────────────────
# Kept explicitly rather than relying on the rule above, because these are the
# two classes whose absence is silent. If R8 ever strips or renames them, the
# app still runs, still signs in and still lists the library — it just cannot
# protect a page.
-keep class com.casanova.reader.MainActivity { *; }
-keep class com.casanova.reader.MainApplication { *; }
-keep class com.casanova.reader.shield.** { *; }

# The companion-object field MainActivity re-reads after a window recreation.
-keepclassmembers class com.casanova.reader.MainActivity$Companion {
    *** isShieldSuppressedByPolicy;
}

# ── react-native-pdf ───────────────────────────────────────
# Reaches pdfium through JNI and its own view classes by name from JavaScript.
-keep class com.github.barteksc.pdfviewer.** { *; }
-keep class com.reactnative.pdfview.** { *; }
-keep class org.pdfview.** { *; }
-dontwarn com.shockwave.pdfium.**
-keep class com.shockwave.pdfium.** { *; }

# ── react-native-blob-util ─────────────────────────────────
# The vault: every file operation in SecureFileVault goes through here.
-keep class com.RNFetchBlob.** { *; }

# ── react-native-keychain ──────────────────────────────────
# Holds the session token. Obfuscation here does not make it more secure — the
# Keystore binding is what does — but breaking it locks every customer out.
-keep class com.oblador.keychain.** { *; }

# ── react-native-device-info ───────────────────────────────
# Supplies the build number the kill switch gates on.
-keep class com.learnium.RNDeviceInfo.** { *; }

# ── @react-native-async-storage/async-storage ───────────────
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# ── react-native-screens / safe-area-context ───────────────
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }

# ── Navigation ─────────────────────────────────────────────
-keep class com.facebook.react.views.modal.** { *; }

# ── General ────────────────────────────────────────────────
# Keep line numbers so a crash report from a customer's phone can be matched to
# a source line. Without this, every release stack trace is a list of offsets
# and `mapping.txt` has to be archived per build — which is worth doing anyway,
# but is not a reason to make the traces unreadable in the meantime.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotations the libraries rely on at runtime.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Kotlin metadata, needed because several of the above libraries are written in
# Kotlin and their public API is read reflectively by React Native.
-keep class kotlin.Metadata { *; }
-dontwarn kotlin.**

# AndroidX / AppCompat references that only resolve at runtime on some API
# levels.
-dontwarn androidx.**
-dontwarn android.os.SystemProperties
