/**
 * Maestro Core — error normalization.
 *
 * Connectors receive many error shapes (PostgREST, network, plain strings).
 * `toMaestroError` normalizes any value into an `Error` so call-sites can rely
 * on `.message` and `.code` without defensive coding.
 */

export class MaestroError extends Error {
  public readonly cause?: unknown;
  public readonly code?: string;

  constructor(message: string, opts?: { cause?: unknown; code?: string }) {
    super(message);
    this.name = "MaestroError";
    this.cause = opts?.cause;
    this.code = opts?.code;
  }
}

export function toMaestroError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err == null) return new MaestroError("Unknown error");
  if (typeof err === "string") return new MaestroError(err);
  if (typeof err === "object") {
    const anyErr = err as { message?: unknown; code?: unknown };
    const message = typeof anyErr.message === "string" ? anyErr.message : JSON.stringify(err);
    const code = typeof anyErr.code === "string" ? anyErr.code : undefined;
    return new MaestroError(message, { cause: err, code });
  }
  return new MaestroError(String(err), { cause: err });
}

export const errorCode = (e: Error | null): string | undefined => (e as MaestroError | null)?.code;

/** True when a create failed because the same idempotency key / unique value already exists. */
export const isDuplicate = (e: Error | null): boolean => {
  const code = errorCode(e);
  return code === "23505" || code === "duplicate";
};

export const forbidden = (what: string) => new MaestroError(`Not allowed: ${what}`, { code: "forbidden" });
