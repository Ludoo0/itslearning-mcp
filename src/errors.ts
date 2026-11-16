export type ErrorCode =
  | "AUTH_FAILED"
  | "SSO_NOT_SUPPORTED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INVALID_INPUT"
  | "FILE_REF_UNKNOWN"
  | "FILE_TOO_LARGE"
  | "NOT_A_FILE"
  | "INTERNAL";

/** Fehler mit einer Meldung, die gefahrlos an den Agenten gehen darf (keine IDs, keine Rohtexte der API). */
export class ToolError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status?: number,
    /** true = nicht automatisch wiederholen (z. B. falsches Passwort → Konto-Sperre vermeiden). */
    public fatal = false,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function toToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  return new ToolError("INTERNAL", "Interner Fehler im itslearning-MCP-Server.");
}
