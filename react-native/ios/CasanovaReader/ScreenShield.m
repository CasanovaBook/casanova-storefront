/*  ScreenShield.m — the Objective-C half of the native module.
 *
 *  There is no implementation here, only the declaration React Native needs to
 *  see the Swift class. `RCT_EXTERN_MODULE` expands to an `@interface` and an
 *  `@implementation` that merge with the `@objc(ScreenShield)` class in
 *  ScreenShield.swift; each `RCT_EXTERN_METHOD` registers one of its selectors
 *  with the bridge.
 *
 *  The two files must be kept in step by hand. Nothing in the toolchain checks
 *  that a selector declared here exists in Swift, and the failure is not a build
 *  error: it is `undefined` returned from the JS side at call time, which
 *  `src/drm/ScreenShield.tsx` turns into `shieldFailed` — so the reader refuses
 *  to open a book and says only that the protection could not be verified.
 *
 *  Argument labels here must match the Swift declaration exactly, including the
 *  `_` on the first parameter, which is why some of these read oddly.
 */

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(ScreenShield, RCTEventEmitter)

/* `enable` resolves a boolean rather than nothing, and the JavaScript layer
 * acts on it: false means the window could not be covered, so the reader does
 * not render the page. See `canProtectSwitcher()` in ScreenShield.swift for what
 * is and is not counted. */
RCT_EXTERN_METHOD(enable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(disable:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isShieldActive:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isCaptured:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isMirrored:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deviceIntegrity:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

/* The two file helpers take a path first. `resolver:` rather than `resolve:`
 * because the Swift signature has to name its second parameter something other
 * than `resolve` once the first is `path` — the labels are part of the selector. */
RCT_EXTERN_METHOD(excludeFromBackup:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sha256File:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(restrictDocumentInteraction:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
