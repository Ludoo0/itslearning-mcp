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
import { getLabels } from "./redaction/labels";
import { Redactor } from "./redaction/redactor";
import { PersonRegistry } from "./redaction/registry";
import { loadOrCreateSecret } from "./redaction/secretKey";
import { TeacherDirectory } from "./redaction/teachers";
import { registerBulletinTools } from "./tools/bulletins";
import { registerChildTools } from "./tools/children";
import { registerCourseTools } from "./tools/courses";
import { registerFileTools } from "./tools/files";
import { registerMessageTools } from "./tools/messages";
import { registerNewsTools } from "./tools/news";
import { registerOverviewTools } from "./tools/overview";
import { registerScheduleTools } from "./tools/schedule";
import { registerTaskTools } from "./tools/tasks";
import { WebBrowser } from "./websession/browser";

const INSTRUCTIONS = `Read-only access to an itslearning account (a school learning platform).
- Start with itslearning_overview (recently overdue and upcoming tasks, recent news, unread messages).
- Tasks: itslearning_list_tasks, details via itslearning_get_task (elementId).
- Courses: itslearning_list_courses (courseId); announcements of a course: itslearning_list_bulletins.
- News: itslearning_list_news. Messages: itslearning_list_message_threads → itslearning_get_message_thread.
- Schedule: itslearning_list_calendar (calendar events), itslearning_list_plans (weekly/lesson plans from the course planner). Both may be empty if the school does not use these features.
- Files: tools return fileRef values (task attachments, message attachments, images, course files via itslearning_list_course_files) → itslearning_download_file. Default: PDF/DOCX/text are returned as redacted text in the field \`text\`.
- Privacy: the account owner appears as "Me" (or the configured redaction language, e.g. "Ich"), teachers by last name ("Teacher Miller", optionally with salutation), other people as pseudonyms ("Student-7F3A", "Person-7F3A"). Email addresses, phone numbers and internal itslearning links are removed. Do not try to reconstruct redacted data.
- Parent accounts (experimental, unverified): itslearning_list_children lists the children as pseudonyms ("Child-7F3A") with childId; pass childId to itslearning_overview, itslearning_list_tasks and itslearning_list_courses (default: the only child).
- The server cannot change anything (no submissions, no sending messages).`;

export function createServer(ctx: AppContext): McpServer {
  const server = new McpServer({ name: "itslearning-mcp", version: pkg.version }, { instructions: INSTRUCTIONS });
  registerOverviewTools(server, ctx);
  registerCourseTools(server, ctx);
  registerTaskTools(server, ctx);
  registerNewsTools(server, ctx);
  registerBulletinTools(server, ctx);
  registerMessageTools(server, ctx);
  registerFileTools(server, ctx);
  registerChildTools(server, ctx);
  registerScheduleTools(server, ctx);
  return server;
}

export function createApp(cfg: Config) {
  registerSecret(cfg.password);
  registerSecret(cfg.apiKey);
  const auth = new TokenStore(cfg);
  // One shared rate limiter for the REST API and the web interface
  const limiter = new Limiter(cfg.maxConcurrency, cfg.minRequestIntervalMs);
  const api = new ApiClient(cfg, auth, fetch, undefined, limiter);
  const it = new Itslearning(api);
  const labels = getLabels(cfg.redactionLanguage);
  const people = new PersonRegistry({
    secret: loadOrCreateSecret(cfg.dataDir, cfg.redactionSecret),
    baseUrl: cfg.baseUrl,
    teachers: new TeacherDirectory(join(cfg.dataDir, "teachers.json")),
    redactTeachers: cfg.redactTeachers,
    teacherRoleTitles: cfg.teacherRoleTitles,
    labels,
  });
  const files = new FileService(it, new WebBrowser(limiter), {
    maxBytes: cfg.maxFileMb * 1_048_576,
    cache: new FileCache(join(cfg.dataDir, "files")),
    labels,
  });
  const redactor = new Redactor(people, { keepWords: new Set(cfg.redactionKeepWords) });
  const ctx = createContext({ cfg, it, redactor, files });
  return { ctx, server: createServer(ctx) };
}
