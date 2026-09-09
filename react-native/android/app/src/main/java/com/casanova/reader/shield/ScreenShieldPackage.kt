package com.casanova.reader.shield

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers [ScreenShieldModule] with the bridge.
 *
 * Referenced from `MainApplication.getPackages()`. There is no
 * `react-native.config.js` entry and no autolinking involved: this is not a
 * published library, it is this app's own DRM layer, and keeping it in the
 * application module means it is compiled, signed and reviewed with the code
 * that depends on it.
 *
 * No view managers, because nothing here draws. The concealment overlay is a
 * React view in `ShieldOverlay` (`src/drm/ScreenShield.tsx`) rather than a
 * native one: it has to sit above the PDF view *and* the navigation chrome,
 * and the only layer that spans both is the React root.
 */
class ScreenShieldPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(ScreenShieldModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}
