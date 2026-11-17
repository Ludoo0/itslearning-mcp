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

/** Error with a message that may safely be shown to the agent (no ids, no raw API texts). */
export class ToolError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status?: number,
    /** true = do not retry automatically (e.g. wrong password → avoid account lockout). */
    public fatal = false,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function toToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  return new ToolError("INTERNAL", "Internal error in the itslearning MCP server.");
}
