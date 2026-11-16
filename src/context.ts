import { detectLoginMode } from "./auth/loginMode";
import type { Itslearning } from "./api/endpoints";
import type { Config } from "./config";
import { ToolError } from "./errors";
import { log } from "./log";
import type { Redactor } from "./redaction/redactor";

/** Die Teile der API, die Tools nutzen (als Interface, damit Tests Fakes einsetzen können). */
export type ItslearningApi = Pick<Itslearning, "person" | "courses" | "starredCourseIds" | "tasks" | "courseTasks" | "assignment">;

export type AppContext = {
  cfg: Pick<Config, "baseUrl" | "redactTeachers">;
  it: ItslearningApi;
  redactor: Redactor;
  /** Stellt sicher, dass Login + Registrierung des eigenen Kontos erfolgt sind (Voraussetzung für Schwärzung). */
  ensureReady(): Promise<void>;
  now(): Date;
};

export function createContext(opts: {
  cfg: AppContext["cfg"];
  it: ItslearningApi;
  redactor: Redactor;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): AppContext {
  let ready: Promise<void> | undefined;
  let fatal: ToolError | undefined;

  const init = async () => {
    try {
      const person = await opts.it.person();
      opts.redactor.registerSelf(person);
      log.info("Bei itslearning angemeldet", { instance: opts.cfg.baseUrl });
    } catch (e) {
      if (e instanceof ToolError && e.fatal) {
        if (e.code === "AUTH_FAILED" && (await detectLoginMode(opts.cfg.baseUrl, opts.fetchImpl)) === "federated-only") {
          fatal = new ToolError(
            "SSO_NOT_SUPPORTED",
            "Diese itslearning-Instanz bietet nur Login über einen fremden Anbieter (Single Sign-on) an – das wird in v1 nicht unterstützt.",
            undefined,
            true,
          );
        } else {
          fatal = e;
        }
        log.error("Anmeldung dauerhaft fehlgeschlagen – keine weiteren Login-Versuche bis zum Neustart", { code: fatal.code });
        throw fatal;
      }
      throw e;
    }
  };

  return {
    cfg: opts.cfg,
    it: opts.it,
    redactor: opts.redactor,
    now: opts.now ?? (() => new Date()),
    ensureReady() {
      if (fatal) return Promise.reject(fatal);
      ready ??= init().catch((e) => {
        ready = undefined; // nicht-fatale Fehler: beim nächsten Tool-Aufruf erneut versuchen
        throw e;
      });
      return ready;
    },
  };
}
