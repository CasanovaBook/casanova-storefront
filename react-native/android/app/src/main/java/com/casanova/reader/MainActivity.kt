package com.casanova.reader

import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * The single Activity in the app.
 *
 * It exists to do one thing that cannot be done from JavaScript: make the
 * window uncapturable before there is anything in it to capture.
 */
class MainActivity : ReactActivity() {

    /** Must match `name` in app.json, which is what index.js registers under. */
    override fun getMainComponentName(): String = "CasanovaReader"

    override fun onCreate(savedInstanceState: Bundle?) {
        /* FLAG_SECURE is set here, before super.onCreate(), and that ordering
         * is the whole point.
         *
         * What the flag does: the window is excluded from the framebuffer that
         * `screencap`, the volume-down/power shortcut, MediaProjection and the
         * recent-apps thumbnail all read from. A screenshot attempt produces a
         * black image or is refused outright; a screen recording captures
         * black for as long as this window is on top. It is the only mechanism
         * Android offers that works against capture tools the app has never
         * heard of, which is why it is used rather than something that listens
         * for capture and reacts.
         *
         * Why before super: `ReactActivity.onCreate` builds the ReactRootView
         * and starts rendering the JavaScript bundle. Setting the flag after
         * that would leave the interval between the first frame and the call —
         * typically a second or two on a cold start, longer on a slow device —
         * during which the window is capturable. If the reader were resumed
         * straight into a book, that interval would contain a page of it.
         *
         * `getWindow()` is safe to call this early: the PhoneWindow is created
         * in `Activity.attach()`, before any lifecycle callback, and
         * `Window.setFlags` only stores the value while the decor is null, so
         * it is applied by the WindowManager when the window is first added.
         * There is no frame in between.
         *
         * Note what this does NOT decide: whether protection is *wanted*. The
         * CMS controls that through `drm_policies.block_screenshots`, and
         * `ScreenShieldModule.disable()` clears the flag when the policy in
         * force says screenshots are allowed. Starting blocked and relaxing on
         * instruction is the only order that fails closed — starting relaxed
         * would mean every launch depends on a network round trip completing
         * before the first frame, and a phone offline at launch would then be
         * unprotected for the whole session.
         */
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )

        super.onCreate(savedInstanceState)
    }

    /**
     * Re-asserts the flag whenever the window is (re)created.
     *
     * `onCreate` covers a cold start, but a configuration change that the
     * manifest does not declare — a locale switch, a font-scale change, a
     * foldable posture change — destroys and recreates the Activity and with
     * it the window. Without this the recreated window would come back without
     * FLAG_SECURE until JavaScript noticed and called `enable()` again, and a
     * screen recording running through the rotation would capture whatever the
     * reader was showing.
     *
     * `onWindowFocusChanged` is used rather than `onResume` because it fires
     * after the new window exists, and because it also covers the case where
     * the window is replaced without the Activity being recreated.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !isShieldSuppressedByPolicy) {
            window.setFlags(
                WindowManager.LayoutParams.FLAG_SECURE,
                WindowManager.LayoutParams.FLAG_SECURE
            )
        }
    }

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    companion object {
        /**
         * Mirrors the state `ScreenShieldModule` last applied, so that a
         * window recreation does not undo a policy decision the module made.
         *
         * A companion field rather than an instance field because the Activity
         * that reads it after a recreation is a different instance from the one
         * the module holds a reference to.
         *
         * Not volatile, deliberately: the module mutates it inside
         * `UiThreadUtil.runOnUiThread` and the lifecycle callback reads it on
         * the same thread, so there is no cross-thread visibility to arrange
         * for. Anything that changes which thread writes it has to revisit
         * this.
         */
        @JvmStatic
        var isShieldSuppressedByPolicy: Boolean = false
    }
}
