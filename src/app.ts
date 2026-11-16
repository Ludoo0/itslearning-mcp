import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { ApiClient } from "./api/client";
import { Itslearning } from "./api/endpoints";
import { TokenStore } from "./auth/tokenStore";
import type { Config } from "./config";
import { type AppContext, createContext } from "./context";
import { registerSecret } from "./log";
import { Redactor } from "./redaction/redactor";
import { registerCourseTools } from "./tools/courses";
import { registerTaskTools } from "./tools/tasks";

const INSTRUCTIONS = `Lesender Zugriff auf ein itslearning-Konto (Lernplattform einer Schule).
- Einstieg: itslearning_list_tasks (offene Aufgaben nach Frist), itslearning_list_courses (Kurse + courseId).
- Details zu einer Aufgabe: itslearning_get_task mit elementId.
- Datenschutz: Das eigene Konto erscheint als "Ich". Personennamen, E-Mail-Adressen, Telefonnummern und interne itslearning-Links sind geschwärzt. Versuche nicht, geschwärzte Daten zu rekonstruieren.
- Der Server kann nichts verändern (keine Abgaben, keine Nachrichten).`;

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "itslearning-mcp", version: pkg.version }, { instructions: INSTRUCTIONS });
  registerCourseTools(server, ctx);
  registerTaskTools(server, ctx);
  return server;
}

export function createApp(cfg: Config) {
  registerSecret(cfg.password);
  registerSecret(cfg.apiKey);
  registerSecret(cfg.redactionSecret);
  const auth = new TokenStore(cfg);
  const api = new ApiClient(cfg, auth);
  const ctx = createContext({ cfg, it: new Itslearning(api), redactor: new Redactor() });
  return { ctx, server: createServer(ctx) };
}
