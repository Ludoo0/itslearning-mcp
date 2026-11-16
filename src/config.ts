import { readFileSync } from "node:fs";
import { z } from "zod";

/** Öffentliche Client-ID der offiziellen itslearning-Mobile-App. */
export const DEFAULT_CLIENT_ID = "10ae9d30-1853-48ff-81cb-47b58a325685";

export type Config = {
  baseUrl: string;
  username: string;
  password: string;
  clientId: string;
  transport: "stdio" | "http";
  port: number;
  apiKey?: string;
  redactionSecret?: string;
  redactTeachers: boolean;
  teacherRoleTitles: string[];
  maxFileMb: number;
  cacheTtlS: number;
  maxConcurrency: number;
  minRequestIntervalMs: number;
  dataDir: string;
  /** Optional: heruntergeladene Dateien zusätzlich hier ablegen (geschwärzter Dateiname). */
  downloadDir?: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export class ConfigError extends Error {
  constructor(public issues: string[]) {
    super(`Ungültige Konfiguration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

/** Liest NAME bzw. NAME_FILE (Docker-Secret, hat Vorrang). Leere Werte zählen als nicht gesetzt. */
function envValue(env: Env, name: string, readFile: ReadFile): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) {
    try {
      return readFile(file).trim() || undefined;
    } catch {
      throw new ConfigError([`${name}_FILE: Datei nicht lesbar (${file})`]);
    }
  }
  const v = env[name]?.trim();
  return v ? v : undefined;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withProto);
  if (u.pathname !== "/" && u.pathname !== "") throw new Error("darf keinen Pfad enthalten");
  return `${u.protocol}//${u.host}`;
}

const boolish = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes");

const intIn = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const DEFAULT_TEACHER_ROLE_TITLES = "Lehrer,Lehrerin,Lehrkraft,Teacher,Mitarbeiter,Staff";

const schema = z.object({
  ITSL_BASE_URL: z.string({ error: "ITSL_BASE_URL fehlt" }),
  ITSL_USERNAME: z.string({ error: "ITSL_USERNAME fehlt" }),
  ITSL_PASSWORD: z.string({ error: "ITSL_PASSWORD fehlt" }),
  ITSL_CLIENT_ID: z.string().default(DEFAULT_CLIENT_ID),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_PORT: intIn(1, 65535).default(3000),
  MCP_API_KEY: z.string().min(32, "MCP_API_KEY muss mindestens 32 Zeichen haben").optional(),
  REDACTION_SECRET: z.string().min(16, "REDACTION_SECRET muss mindestens 16 Zeichen haben").optional(),
  REDACT_TEACHERS: boolish.default(false),
  TEACHER_ROLE_TITLES: z.string().default(DEFAULT_TEACHER_ROLE_TITLES),
  MAX_FILE_MB: intIn(1, 500).default(25),
  CACHE_TTL_S: intIn(0, 3600).default(60),
  MAX_CONCURRENCY: intIn(1, 8).default(2),
  MIN_REQUEST_INTERVAL_MS: intIn(0, 10_000).default(200),
  DATA_DIR: z.string().default("/data"),
  DOWNLOAD_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const KEYS = Object.keys(schema.shape) as (keyof typeof schema.shape)[];

export function loadConfig(env: Env = process.env, readFile: ReadFile = (p) => readFileSync(p, "utf8")): Config {
  const raw: Record<string, string | undefined> = {};
  for (const k of KEYS) raw[k] = envValue(env, k, readFile);

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => (i.message.includes(String(i.path[0])) ? i.message : `${String(i.path[0])}: ${i.message}`)));
  }
  const c = parsed.data;

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(c.ITSL_BASE_URL);
  } catch (e) {
    throw new ConfigError([`ITSL_BASE_URL ungültig: ${e instanceof Error ? e.message : e}`]);
  }
  if (c.MCP_TRANSPORT === "http" && !c.MCP_API_KEY) {
    throw new ConfigError(["MCP_API_KEY ist bei MCP_TRANSPORT=http Pflicht"]);
  }

  return {
    baseUrl,
    username: c.ITSL_USERNAME,
    password: c.ITSL_PASSWORD,
    clientId: c.ITSL_CLIENT_ID,
    transport: c.MCP_TRANSPORT,
    port: c.MCP_PORT,
    apiKey: c.MCP_API_KEY,
    redactionSecret: c.REDACTION_SECRET,
    redactTeachers: c.REDACT_TEACHERS,
    teacherRoleTitles: c.TEACHER_ROLE_TITLES.split(",").map((s) => s.trim()).filter(Boolean),
    maxFileMb: c.MAX_FILE_MB,
    cacheTtlS: c.CACHE_TTL_S,
    maxConcurrency: c.MAX_CONCURRENCY,
    minRequestIntervalMs: c.MIN_REQUEST_INTERVAL_MS,
    dataDir: c.DATA_DIR,
    downloadDir: c.DOWNLOAD_DIR,
    logLevel: c.LOG_LEVEL,
  };
}
