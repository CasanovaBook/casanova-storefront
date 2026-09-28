/**
 * Maestro Core — public entry point.
 *
 * Consumers import from "@/maestro" only, never from deeper paths.
 */

export { maestro, configureMaestro } from "./core/maestroClient";
export type { MaestroClient } from "./core/maestroClient";
export * from "./core/types";
export { MaestroError, toMaestroError, isDuplicate, errorCode } from "./core/errors";
export type { MaestroConnector, Collection, AuthConnector } from "./connectors/MaestroConnector";
