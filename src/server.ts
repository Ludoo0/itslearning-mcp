#!/usr/bin/env bun
/**
 * Einstiegspunkt des itslearning-MCP-Servers.
 * MCP_TRANSPORT=stdio (Default, lokale Clients) oder http (Streamable HTTP, z. B. im Docker-Container).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp, createServer } from "./app";
import { ConfigError, loadConfig } from "./config";
import { startHttpServer } from "./http";
import { log, setLogLevel } from "./log";

async function main() {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    process.stderr.write(`${e instanceof ConfigError ? e.message : "Konfiguration konnte nicht geladen werden."}\n`);
    process.exit(2);
  }
  setLogLevel(cfg.logLevel);

  const { ctx, server } = createApp(cfg);

  // Früh anmelden, damit Fehler sofort im Log stehen. Der Server startet trotzdem:
  // Tools melden den Fehler dann strukturiert (und bei falschem Passwort ohne erneuten Login-Versuch).
  ctx.ensureReady().catch(() => {});

  let stop: () => Promise<void>;
  if (cfg.transport === "http") {
    const http = startHttpServer(ctx, {
      host: cfg.host,
      port: cfg.port,
      apiKey: cfg.apiKey!, // von loadConfig bei http erzwungen
      allowedOrigins: cfg.allowedOrigins,
      createServer,
    });
    stop = async () => {
      await http.stop();
    };
  } else {
    await server.connect(new StdioServerTransport());
    log.info("itslearning-MCP-Server läuft", { transport: "stdio", instance: cfg.baseUrl });
    stop = () => server.close();
  }

  const shutdown = async () => {
    await stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  log.error("Server-Start fehlgeschlagen", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
