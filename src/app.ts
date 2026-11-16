import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { ApiClient } from "./api/client";
import { Itslearning } from "./api/endpoints";
import { Limiter } from "./api/limiter";
import { TokenStore } from "./auth/tokenStore";
import type { Config } from "./config";
import { type AppContext, createContext } from "./context";
import { FileCache } from "./files/cache";
import { FileService } from "./files/service";
import { registerSecret } from "./log";
import { Redactor } from "./redaction/redactor";
import { PersonRegistry } from "./redaction/registry";
import { loadOrCreateSecret } from "./redaction/secretKey";
import { TeacherDirectory } from "./redaction/teachers";
import { registerBulletinTools } from "./tools/bulletins";
import { registerCourseTools } from "./tools/courses";
import { registerFileTools } from "./tools/files";
import { registerMessageTools } from "./tools/messages";
import { registerNewsTools } from "./tools/news";
import { registerOverviewTools } from "./tools/overview";
import { registerTaskTools } from "./tools/tasks";
import { WebBrowser } from "./websession/browser";

const INSTRUCTIONS = `Lesender Zugriff auf ein itslearning-Konto (Lernplattform einer Schule).
- Einstieg: itslearning_overview (überfällige/fällige Aufgaben, Neuigkeiten, ungelesene Nachrichten).
- Aufgaben: itslearning_list_tasks, Details mit itslearning_get_task (elementId).
- Kurse: itslearning_list_courses (courseId), Ankündigungen eines Kurses: itslearning_list_bulletins.
- Neuigkeiten: itslearning_list_news. Nachrichten: itslearning_list_message_threads → itslearning_get_message_thread.
- Dateien: Tools liefern fileRef-Werte (Aufgaben-Anhänge, Nachrichten-Anhänge, Bilder, Kurs-Dateien via itslearning_list_course_files) → itslearning_download_file. Standard: PDF/DOCX/Text als geschwärzter Text.
- Datenschutz: Das eigene Konto erscheint als "Ich", Lehrkräfte als "Frau/Herr Nachname" oder "Lehrkraft Nachname", andere Personen als Pseudonym ("Schüler:in-7F3A", "Person-7F3A"). E-Mail-Adressen, Telefonnummern und interne itslearning-Links sind entfernt. Versuche nicht, geschwärzte Daten zu rekonstruieren.
- Der Server kann nichts verändern (keine Abgaben, keine Nachrichten senden).`;

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "itslearning-mcp", version: pkg.version }, { instructions: INSTRUCTIONS });
  registerOverviewTools(server, ctx);
  registerCourseTools(server, ctx);
  registerTaskTools(server, ctx);
  registerNewsTools(server, ctx);
  registerBulletinTools(server, ctx);
  registerMessageTools(server, ctx);
  registerFileTools(server, ctx);
  return server;
}

export function createApp(cfg: Config) {
  registerSecret(cfg.password);
  registerSecret(cfg.apiKey);
  const auth = new TokenStore(cfg);
  // Eine gemeinsame Drosselung für REST-API und Web-Oberfläche
  const limiter = new Limiter(cfg.maxConcurrency, cfg.minRequestIntervalMs);
  const api = new ApiClient(cfg, auth, fetch, undefined, limiter);
  const it = new Itslearning(api);
  const people = new PersonRegistry({
    secret: loadOrCreateSecret(cfg.dataDir, cfg.redactionSecret),
    baseUrl: cfg.baseUrl,
    teachers: new TeacherDirectory(join(cfg.dataDir, "teachers.json")),
    redactTeachers: cfg.redactTeachers,
    teacherRoleTitles: cfg.teacherRoleTitles,
  });
  const files = new FileService(it, new WebBrowser(limiter), {
    maxBytes: cfg.maxFileMb * 1_048_576,
    cache: new FileCache(join(cfg.dataDir, "files")),
  });
  const ctx = createContext({ cfg, it, redactor: new Redactor(people), files });
  return { ctx, server: createServer(ctx) };
}
