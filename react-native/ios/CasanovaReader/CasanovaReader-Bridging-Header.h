/*  CasanovaReader-Bridging-Header.h
 *
 *  Makes React Native's Objective-C headers visible to ScreenShield.swift.
 *  Referenced by the `SWIFT_OBJC_BRIDGING_HEADER` build setting in project.yml;
 *  a wrong path there is a "cannot find RCTEventEmitter in scope" error on the
 *  first line of the Swift file, not a build-setting complaint.
 *
 *  Only what ScreenShield.swift actually names is imported. Adding headers here
 *  is not free: everything in this file is recompiled into every Swift
 *  translation unit of the target.
 */

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
