import type { Itslearning } from "./api/endpoints";
import { detectLoginMode } from "./auth/loginMode";
import type { Config } from "./config";
import { ToolError } from "./errors";
import type { FileService } from "./files/service";
import { log } from "./log";
import type { Redactor } from "./redaction/redactor";
import { registerThread } from "./tools/people";

/** The parts of the API used by tools (an interface so tests can plug in fakes). */
export type ItslearningApi = Pick<
  Itslearning,
  | "person"
  | "courses"
  | "starredCourseIds"
  | "tasks"
  | "courseTasks"
  | "assignment"
  | "notificationStream"
  | "courseStream"
  | "courseBulletins"
  | "bulletinElements"
  | "messageThreads"
  | "threadMessages"
  | "courseResources"
  | "folderResources"
  | "resource"
  | "ssoUrl"
  | "assignmentFileLocation"
  | "courseParticipants"
  | "children"
  | "childCourses"
  | "childTasks"
  | "childCourseTasks"
  | "calendarEvents"
  | "courseCalendarEvents"
  | "coursePlans"
  | "plansInfo"
>;

export type AppContext = {
  cfg: Pick<Config, "baseUrl" | "redactTeachers" | "downloadDir">;
  it: ItslearningApi;
  redactor: Redactor;
  files: FileService;
  /** Ensures login and registration of the own account have happened (prerequisite for redaction). */
  ensureReady(): Promise<void>;
  now(): Date;
};

export function createContext(opts: {
  cfg: AppContext["cfg"];
  it: ItslearningApi;
  redactor: Redactor;
  files: FileService;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): AppContext {
  let ready: Promise<void> | undefined;
  let fatal: ToolError | undefined;

  const init = async () => {
    try {
      const person = await opts.it.person();
      opts.redactor.registerSelf(person);
      log.info("Logged in to itslearning", { instance: opts.cfg.baseUrl });
    } catch (e) {
      if (e instanceof ToolError && e.fatal) {
        if (e.code === "AUTH_FAILED" && (await detectLoginMode(opts.cfg.baseUrl, opts.fetchImpl)) === "federated-only") {
          fatal = new ToolError(
            "SSO_NOT_SUPPORTED",
            "This itslearning instance only offers login via an external identity provider (single sign-on), which is not supported.",
            undefined,
            true,
          );
        } else {
          fatal = e;
        }
        log.error("Login failed permanently – no further login attempts until restart", { code: fatal.code });
        throw fatal;
      }
      throw e;
    }

    // Warm up the name dictionary with participants of the latest conversations (classmates, teachers)
    // so their names are also recognized in task and news texts. Errors here are not critical.
    try {
      const threads = await opts.it.messageThreads(50);
      for (const t of threads.Threads?.EntityArray ?? []) registerThread(opts.redactor.people, t);
    } catch {
      log.warn("Could not warm up the name dictionary (messages not available)");
    }
  };

  return {
    cfg: opts.cfg,
    it: opts.it,
    redactor: opts.redactor,
    files: opts.files,
    now: opts.now ?? (() => new Date()),
    ensureReady() {
      if (fatal) return Promise.reject(fatal);
      ready ??= init().catch((e) => {
        ready = undefined; // non-fatal errors: retry on the next tool call
        throw e;
      });
      return ready;
    },
  };
}
