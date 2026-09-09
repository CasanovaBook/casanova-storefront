package com.casanova.reader

import android.app.Application
import com.casanova.reader.shield.ScreenShieldPackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

class MainApplication : Application(), ReactApplication {

    override val reactNativeHost: ReactNativeHost =
        object : DefaultReactNativeHost(this) {

            /**
             * Autolinked packages plus ScreenShield.
             *
             * ScreenShield is registered by hand because it is part of this
             * app rather than a dependency: it is the DRM layer, and keeping
             * its source in the repository means a change to how the window is
             * protected is reviewed alongside the change to the reader that
             * depends on it.
             *
             * `PackageList(this).packages` returns a mutable list, so `apply`
             * adds to it in place and returns it — the same shape the React
             * Native template uses for manually linked packages.
             */
            override fun getPackages(): List<ReactPackage> =
                PackageList(this).packages.apply {
                    add(ScreenShieldPackage())
                }

            override fun getJSMainModuleName(): String = "index"

            override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

            override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED

            override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
        }

    override val reactHost: ReactHost
        get() = getDefaultReactHost(applicationContext, reactNativeHost)

    override fun onCreate() {
        super.onCreate()
        SoLoader.init(this, OpenSourceMergedSoMapping)
        if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
            /* Loads the Fabric/TurboModule runtime. Called after SoLoader
             * because it resolves through it. */
            load()
        }
    }
}
