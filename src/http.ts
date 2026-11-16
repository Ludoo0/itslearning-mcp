/**
 * Streamable-HTTP-Transport (Spec 8.1) auf Basis von Bun.serve + Web-Standard-Transport des SDK.
 *
 * - POST /mcp  – MCP (zustandslos, JSON-Antworten); Authorization: Bearer <MCP_API_KEY> Pflicht
 * - GET  /healthz – ohne Auth, ohne Details
 * Pro Anfrage ein frischer McpServer über dem gemeinsamen AppContext (Login, Caches, Personen-Registry bleiben erhalten).
 */
import { timingSafeEqual } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext } from "./context";
import { log } from "./log";

export type HttpOptions = {
  host: string;
  port: number;
  apiKey: string;
  /** Erlaubte Browser-Origins (leer = Anfragen mit Origin-Header werden abgelehnt → Schutz vor DNS-Rebinding). */
  allowedOrigins?: string[];
  createServer: (ctx: AppContext) => McpServer;
};

const MAX_BODY_BYTES = 1_048_576;

function keyMatches(header: string | null, apiKey: string): boolean {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const given = Buffer.from(m[1]!.trim());
  const expected = Buffer.from(apiKey);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  json(status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);

export function startHttpServer(ctx: AppContext, opts: HttpOptions) {
  const allowed = new Set(opts.allowedOrigins ?? []);

  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    maxRequestBodySize: MAX_BODY_BYTES,
    async fetch(req) {
      const url = new URL(req.url);
      const t0 = Date.now();

      if (url.pathname === "/healthz") {
        return req.method === "GET" || req.method === "HEAD" ? json(200, { status: "ok" }) : new Response(null, { status: 405 });
      }
      if (url.pathname !== "/mcp") return new Response("Not Found", { status: 404 });

      const origin = req.headers.get("origin");
      if (origin && !allowed.has(origin)) {
        log.warn("http: Origin abgelehnt");
        return rpcError(403, "Origin not allowed");
      }
      if (!keyMatches(req.headers.get("authorization"), opts.apiKey)) {
        log.warn("http: ungültiger oder fehlender API-Key");
        return rpcError(401, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="itslearning-mcp"' });
      }
      // Zustandsloser Modus: kein SSE-Stream (GET) und keine Sessions (DELETE)
      if (req.method !== "POST") return rpcError(405, "Method not allowed", { Allow: "POST" });

      const mcp = opts.createServer(ctx);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await mcp.connect(transport);
        const res = await transport.handleRequest(req);
        log.debug("http", { status: res.status, ms: Date.now() - t0 });
        return res;
      } catch (e) {
        log.error("http: Fehler bei der Verarbeitung", { error: e instanceof Error ? e.message : String(e) });
        return rpcError(500, "Internal server error");
      } finally {
        // Antwort ist bei enableJsonResponse vollständig → Server/Transport freigeben
        queueMicrotask(() => {
          mcp.close().catch(() => {});
        });
      }
    },
  });

  log.info("itslearning-MCP-Server läuft", { transport: "http", host: opts.host, port: server.port });
  return server;
}
