/**
 * Teacher directory DATA_DIR/teachers.json (spec 6.2).
 * The server adds newly detected teachers automatically (last name, empty salutation); the user maintains "salutation".
 * No PersonId and no first names in the file – only a pseudonymous key.
 * Changes to the file are picked up without a restart.
 * Migration: files written by older versions use the field "anrede" – it is still read.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../log";

export type TeacherEntry = { id: string; lastName: string; salutation: string };

type FileEntry = { id?: unknown; lastName?: unknown; salutation?: unknown; anrede?: unknown };
type FileShape = { _hint?: string; teachers: FileEntry[] };

const HINT =
  'Set "salutation" (e.g. "Mrs", "Mr", "Frau", "Herr") or leave it empty → "Teacher <last name>". Changes apply without restart.';
const RELOAD_CHECK_MS = 2_000;

export class TeacherDirectory {
  private entries = new Map<string, TeacherEntry>();
  private mtimeMs = 0;
  private lastCheck = 0;
  /** File broken by a manual edit → never overwrite until it is valid again. */
  private fileBroken = false;
  /** File still uses the old "anrede" field → rewrite once with "salutation". */
  private needsMigration = false;
  private _version = 0;

  constructor(
    /** null = in-memory only (tests, read-only operation) */
    private path: string | null,
    private now: () => number = Date.now,
  ) {
    this.reload(true);
    if (this.needsMigration) this.persist();
  }

  /** Increases on every content change (displays must be recomputed). */
  get version() {
    this.maybeReload();
    return this._version;
  }

  has(id: string): boolean {
    this.maybeReload();
    return this.entries.has(id);
  }

  get(id: string): TeacherEntry | undefined {
    this.maybeReload();
    return this.entries.get(id);
  }

  /** Adds a teacher if new. Returns true if an entry was created. */
  ensure(id: string, lastName: string): boolean {
    this.maybeReload();
    const existing = this.entries.get(id);
    if (existing) {
      if (!existing.lastName && lastName) {
        existing.lastName = lastName;
        this.persist();
      }
      return false;
    }
    this.entries.set(id, { id, lastName, salutation: "" });
    this._version++;
    this.persist();
    return true;
  }

  private maybeReload() {
    const t = this.now();
    if (t - this.lastCheck < RELOAD_CHECK_MS) return;
    this.lastCheck = t;
    this.reload(false);
  }

  private reload(initial: boolean) {
    if (!this.path) return;
    let mtime: number;
    try {
      mtime = statSync(this.path).mtimeMs;
    } catch {
      return; // file does not exist (yet)
    }
    if (!initial && mtime === this.mtimeMs) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as FileShape;
      const next = new Map<string, TeacherEntry>();
      for (const e of parsed.teachers ?? []) {
        if (!e || typeof e.id !== "string") continue;
        if (e.salutation === undefined && e.anrede !== undefined) this.needsMigration = true;
        next.set(e.id, { id: e.id, lastName: String(e.lastName ?? "").trim(), salutation: normalizeSalutation(e.salutation ?? e.anrede) });
      }
      // Keep entries that only exist in memory (not written yet)
      for (const [id, e] of this.entries) if (!next.has(id)) next.set(id, e);
      this.entries = next;
      this.mtimeMs = mtime;
      this.fileBroken = false;
      this._version++;
      if (!initial) log.info("teachers.json reloaded", { teachers: next.size });
    } catch {
      if (!this.fileBroken) log.warn("teachers.json is not valid JSON – it will not be overwritten until it is fixed");
      this.fileBroken = true;
      this.mtimeMs = mtime;
    }
  }

  private persist() {
    if (!this.path || this.fileBroken) return;
    const data: FileShape = {
      _hint: HINT,
      teachers: [...this.entries.values()].sort((a, b) => a.lastName.localeCompare(b.lastName)),
    };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.path);
      this.mtimeMs = statSync(this.path).mtimeMs;
      this.needsMigration = false;
    } catch (e) {
      log.warn("Could not write teachers.json", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function normalizeSalutation(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}
