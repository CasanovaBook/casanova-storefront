/* App entry.
 *
 * Capture protection is deliberately NOT enabled here. On Android the
 * FLAG_SECURE window flag is set in `MainActivity.onCreate`, which runs
 * before the JavaScript bundle is even parsed — a JS-side enable would
 * leave a window of a second or two in which the splash and the first
 * frame are screenshot-able. On iOS the shield is installed by the
 * `ScreenShield` native module the moment the reader screen mounts.
 *
 * Everything this file does is register the root component.
 */

import { AppRegistry } from "react-native"

import App from "./App"

import { name as appName } from "./app.json"

AppRegistry.registerComponent(appName, () => App)
