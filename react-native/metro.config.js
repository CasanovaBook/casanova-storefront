/* Metro configuration.
 *
 * The only deviation from the React Native default is `blockList`: the
 * sibling web project one directory up is a Vite + Tailwind app with its
 * own `node_modules`. Metro walks the file system, not the module graph,
 * so without an explicit block it will happily resolve `react` or
 * `react-dom` out of `../node_modules` and bundle a web copy of React
 * into the phone build. The failure it produces is confusing enough
 * ("Invariant Violation: requireNativeComponent") that it is worth
 * preventing rather than documenting.
 */

const path = require("path")

const exclusionList = require("metro-config/src/defaults/exclusionList")

const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config")

const projectRoot = __dirname

const workspaceRoot = path.resolve(projectRoot, "..")

const config = {
  watchFolders: [],

  blockList: exclusionList([
    new RegExp(
      `${escapeRegExp(path.join(workspaceRoot, "node_modules"))}[/\\\\].*`,
    ),

    new RegExp(`${escapeRegExp(path.join(workspaceRoot, "dist"))}[/\\\\].*`),

    new RegExp(`${escapeRegExp(path.join(workspaceRoot, "src"))}[/\\\\].*`),
  ]),

  resolver: {
    /* Keep resolution inside this project. `react` and `react-native` must
     * come from `react-native/node_modules` and `./node_modules` only. */

    nodeModulesPaths: [path.join(projectRoot, "node_modules")],
  },
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

module.exports = mergeConfig(getDefaultConfig(projectRoot), config)
