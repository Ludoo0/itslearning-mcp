#!/usr/bin/env bun
/**
 * Entry point of the itslearning MCP server.
 * MCP_TRANSPORT=stdio (default, local clients) or http (Streamable HTTP, e.g. in the Docker container).
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
    process.stderr.write(`${e instanceof ConfigError ? e.message : "Could not load the configuration."}\n`);
    process.exit(2);
  }
  setLogLevel(cfg.logLevel);

  const { ctx, server } = createApp(cfg);

  // Log in early so errors show up in the log right away. The server starts anyway:
  // tools then report the error in a structured way (and a wrong password is never retried).
  ctx.ensureReady().catch(() => {});

  let stop: () => Promise<void>;
  if (cfg.transport === "http") {
    const http = startHttpServer(ctx, {
      host: cfg.host,
      port: cfg.port,
      apiKey: cfg.apiKey!, // enforced by loadConfig for http
      allowedOrigins: cfg.allowedOrigins,
      createServer,
    });
    stop = async () => {
      await http.stop();
    };
  } else {
    await server.connect(new StdioServerTransport());
    log.info("itslearning MCP server running", { transport: "stdio", instance: cfg.baseUrl });
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
  log.error("Server start failed", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
