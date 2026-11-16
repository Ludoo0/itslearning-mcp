/**
 * Lehrkräfte-Verzeichnis DATA_DIR/teachers.json (Spec 6.2).
 * Der Server ergänzt neue Lehrkräfte automatisch (Nachname, leere Anrede); der Nutzer pflegt "anrede".
 * Keine PersonId, keine Vornamen in der Datei – nur ein Pseudonym-Schlüssel.
 * Änderungen an der Datei werden ohne Neustart übernommen.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { log } from "../log";

export type TeacherEntry = { id: string; lastName: string; anrede: string };

type FileShape = { _hinweis?: string; teachers: TeacherEntry[] };

const HINWEIS = 'anrede eintragen: "Frau", "Herr" oder leer lassen (dann "Lehrkraft <Nachname>"). Änderungen werden ohne Neustart übernommen.';
const RELOAD_CHECK_MS = 2_000;

export class TeacherDirectory {
  private entries = new Map<string, TeacherEntry>();
  private mtimeMs = 0;
  private lastCheck = 0;
  /** Datei vom Nutzer kaputt editiert → nicht überschreiben, bis sie wieder gültig ist. */
  private fileBroken = false;
  private _version = 0;

  constructor(
    /** null = nur im Speicher (Tests, read-only Betrieb) */
    private path: string | null,
    private now: () => number = Date.now,
  ) {
    this.reload(true);
  }

  /** Steigt bei jeder inhaltlichen Änderung (Anzeige muss neu berechnet werden). */
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

  /** Lehrkraft eintragen, falls neu. Gibt true zurück, wenn ein Eintrag angelegt wurde. */
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
    this.entries.set(id, { id, lastName, anrede: "" });
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
      return; // Datei existiert (noch) nicht
    }
    if (!initial && mtime === this.mtimeMs) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as FileShape;
      const next = new Map<string, TeacherEntry>();
      for (const e of parsed.teachers ?? []) {
        if (!e || typeof e.id !== "string") continue;
        next.set(e.id, { id: e.id, lastName: String(e.lastName ?? "").trim(), anrede: normalizeAnrede(e.anrede) });
      }
      // Einträge, die nur im Speicher sind (noch nicht geschrieben), behalten
      for (const [id, e] of this.entries) if (!next.has(id)) next.set(id, e);
      this.entries = next;
      this.mtimeMs = mtime;
      this.fileBroken = false;
      this._version++;
      if (!initial) log.info("teachers.json neu geladen", { teachers: next.size });
    } catch {
      if (!this.fileBroken) log.warn("teachers.json ist kein gültiges JSON – wird nicht überschrieben, bis sie repariert ist");
      this.fileBroken = true;
      this.mtimeMs = mtime;
    }
  }

  private persist() {
    if (!this.path || this.fileBroken) return;
    const data: FileShape = {
      _hinweis: HINWEIS,
      teachers: [...this.entries.values()].sort((a, b) => a.lastName.localeCompare(b.lastName, "de")),
    };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, this.path);
      this.mtimeMs = statSync(this.path).mtimeMs;
    } catch (e) {
      log.warn("teachers.json konnte nicht geschrieben werden", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function normalizeAnrede(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}
