import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "../context";
import { ToolError, toToolError } from "../errors";
import { log } from "../log";

/** Erfolg: strukturierte Daten + Text (Zusammenfassung + JSON) für Clients ohne structuredContent. */
export function ok(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  };
}

export function fail(e: unknown): CallToolResult {
  const err = toToolError(e);
  return {
    isError: true,
    content: [{ type: "text", text: `${err.code}: ${err.message}` }],
    structuredContent: { error: { code: err.code, message: err.message } },
  };
}

/** Rahmen für jeden Tool-Handler: Login sicherstellen, Fehler sauber abbilden und loggen. */
export function handler<A>(ctx: AppContext, tool: string, fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    const t0 = Date.now();
    try {
      await ctx.ensureReady();
      const res = await fn(args);
      log.info("tool", { tool, ok: true, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      if (e instanceof ToolError) log.warn("tool", { tool, ok: false, code: e.code, ms: Date.now() - t0 });
      else log.error("tool: interner Fehler", { tool, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
      return fail(e);
    }
  };
}
