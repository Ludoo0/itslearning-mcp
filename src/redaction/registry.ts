/**
 * Personen-Registry (Spec 6.1/6.2): sammelt alle Personen aus API-Antworten (über PersonId),
 * leitet Rollen ab und liefert die Anzeige:
 *   self → "Ich" · teacher → "Frau Müller" / "Lehrkraft Müller" · student → "Schüler:in-7F3A" · unknown → "Person-7F3A"
 */
import { createHmac } from "node:crypto";
import type { ApiCourseParticipant, ApiParticipant } from "../api/types";
import type { PersonNames } from "./freetext";
import type { TeacherDirectory } from "./teachers";

export type Role = "self" | "teacher" | "student" | "unknown";
export type Person = { display: string; role: Role };

/**
 * Wie sicher ist eine Rollen-Information?
 * - teacher / student: belastbar (RoleInHierarchyTitle, CreatedByTeacher)
 * - teacher-weak: Indiz (z. B. Autor eines Bulletins) – gilt nur, wenn nichts dagegen spricht
 */
export type RoleHint = "teacher" | "student" | "teacher-weak" | "none";

type Record_ = {
  id: number;
  names: PersonNames;
  teacher: boolean;
  student: boolean;
  weakTeacher: boolean;
};

export type RegistryOptions = {
  secret: string;
  baseUrl: string;
  teachers: TeacherDirectory;
  redactTeachers: boolean;
  teacherRoleTitles: string[];
};

const clean = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim() || undefined;

export class PersonRegistry {
  private persons = new Map<number, Record_>();
  private selfId?: number;
  private shortIds = new Map<number, string>();
  private usedShortIds = new Map<string, number>();
  private teacherTitles: string[];
  private _version = 0;

  constructor(private opts: RegistryOptions) {
    this.teacherTitles = opts.teacherRoleTitles.map((t) => t.toLowerCase());
  }

  /** Ändert sich, wenn sich Namen oder Anzeigen ändern (→ Namens-Wörterbuch neu bauen). */
  get version() {
    return this._version * 100_000 + this.opts.teachers.version;
  }

  get selfPersonId() {
    return this.selfId;
  }

  setSelf(id: number, names: PersonNames) {
    this.selfId = id;
    this.register(id, names, "none");
  }

  /** Person registrieren bzw. um Namen/Rollen-Hinweis ergänzen. */
  register(id: number | null | undefined, names: PersonNames = {}, hint: RoleHint = "none") {
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) return;
    let rec = this.persons.get(id);
    if (!rec) {
      rec = { id, names: {}, teacher: false, student: false, weakTeacher: false };
      this.persons.set(id, rec);
      this._version++;
    }
    for (const key of ["firstName", "lastName", "fullName", "shortName"] as const) {
      const v = clean(names[key]);
      if (v && rec.names[key] !== v) {
        rec.names[key] = v;
        this._version++;
      }
    }
    const before = this.role(id);
    if (hint === "teacher") rec.teacher = true;
    if (hint === "student") rec.student = true;
    if (hint === "teacher-weak") rec.weakTeacher = true;
    if (this.role(id) !== before) this._version++;
    if (this.role(id) === "teacher" && rec.names.lastName) this.opts.teachers.ensure(this.teacherKey(id), rec.names.lastName);
  }

  /** Teilnehmer eines Nachrichten-Threads: Rolle aus RoleInHierarchyTitle. */
  registerParticipant(p: ApiParticipant) {
    const title = clean(p.RoleInHierarchyTitle)?.toLowerCase();
    const hint: RoleHint = !title ? "none" : this.teacherTitles.some((t) => title.includes(t)) ? "teacher" : "student";
    this.register(p.PersonId, { firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName }, hint);
  }

  /** Kurs-Teilnehmer:in: nur FullName + Rolle (Kurs-Profil) vorhanden → Vor-/Nachname heuristisch trennen. */
  registerCourseParticipant(p: ApiCourseParticipant) {
    const full = clean(p.FullName);
    let firstName: string | undefined;
    let lastName: string | undefined;
    if (full?.includes(",")) {
      [lastName, firstName] = full.split(",", 2).map((s) => s.trim());
    } else if (full) {
      const parts = full.split(" ");
      if (parts.length > 1) {
        lastName = parts.at(-1);
        firstName = parts.slice(0, -1).join(" ");
      }
    }
    const role = clean(p.Role)?.toLowerCase();
    const hint: RoleHint = !role ? "none" : this.teacherTitles.some((t) => role.includes(t)) ? "teacher" : "student";
    this.register(p.PersonId, { fullName: full, firstName, lastName }, hint);
  }

  role(id: number | null | undefined): Role {
    if (typeof id !== "number") return "unknown";
    if (id === this.selfId) return "self";
    const rec = this.persons.get(id);
    if (this.opts.teachers.has(this.teacherKey(id))) return "teacher";
    if (!rec) return "unknown";
    if (rec.teacher) return "teacher";
    if (rec.student) return "student";
    if (rec.weakTeacher) return "teacher";
    return "unknown";
  }

  /** Anzeige einer Person. Unbekannte IDs ohne Daten → "Person-XXXX". */
  resolve(id: number | null | undefined): Person {
    const role = this.role(id);
    if (typeof id !== "number") return { display: "Unbekannt", role: "unknown" };
    if (role === "self") return { display: "Ich", role };
    const short = this.shortId(id);
    if (role === "teacher") {
      if (this.opts.redactTeachers) return { display: `Lehrkraft-${short}`, role };
      const entry = this.opts.teachers.get(this.teacherKey(id));
      const last = entry?.lastName || this.persons.get(id)?.names.lastName;
      if (!last) return { display: `Lehrkraft-${short}`, role };
      return { display: entry?.anrede ? `${entry.anrede} ${last}` : `Lehrkraft ${last}`, role };
    }
    if (role === "student") return { display: `Schüler:in-${short}`, role };
    return { display: `Person-${short}`, role };
  }

  /** Alle bekannten Personen mit Namen + Anzeige – Grundlage des Namens-Wörterbuchs. */
  dictionaryEntries(): { names: PersonNames; display: string; withTitles: boolean }[] {
    return [...this.persons.values()].map((r) => {
      const p = this.resolve(r.id);
      return { names: r.names, display: p.display, withTitles: p.role === "teacher" };
    });
  }

  private hmac(id: number) {
    return createHmac("sha256", this.opts.secret).update(`${this.opts.baseUrl}|${id}`).digest("hex").toUpperCase();
  }

  /** Stabiler Schlüssel für teachers.json (8 Hex-Zeichen, keine PersonId). */
  teacherKey(id: number) {
    return this.hmac(id).slice(0, 8);
  }

  /** Kurzes Pseudonym (4 Zeichen, bei Kollision 6). */
  private shortId(id: number) {
    const cached = this.shortIds.get(id);
    if (cached) return cached;
    const h = this.hmac(id);
    let short = h.slice(0, 4);
    if (this.usedShortIds.has(short) && this.usedShortIds.get(short) !== id) short = h.slice(0, 6);
    this.shortIds.set(id, short);
    this.usedShortIds.set(short, id);
    return short;
  }
}
