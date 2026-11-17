/**
 * Person registry (spec 6.1/6.2): collects every person seen in API responses (by PersonId),
 * infers roles and produces the display (labels per REDACTION_LANGUAGE, English shown):
 *   self → "Me" · teacher → "Mrs Miller" / "Teacher Miller" · student → "Student-7F3A" · unknown → "Person-7F3A"
 */
import { createHmac } from "node:crypto";
import type { ApiCourseParticipant, ApiParticipant } from "../api/types";
import type { PersonNames } from "./freetext";
import { LABELS, type Labels } from "./labels";
import type { TeacherDirectory } from "./teachers";

export type Role = "self" | "teacher" | "student" | "unknown";
export type Person = { display: string; role: Role };

/**
 * How reliable is a role hint?
 * - teacher / student: reliable (RoleInHierarchyTitle, CreatedByTeacher, course profile)
 * - teacher-weak: circumstantial (e.g. author of a bulletin) – only applies if nothing contradicts it
 */
export type RoleHint = "teacher" | "student" | "teacher-weak" | "none";

type PersonRecord = {
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
  labels?: Labels;
};

const clean = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim() || undefined;

export class PersonRegistry {
  readonly labels: Labels;
  private persons = new Map<number, PersonRecord>();
  private selfId?: number;
  private shortIds = new Map<number, string>();
  private usedShortIds = new Map<string, number>();
  private teacherTitles: string[];
  private _version = 0;

  constructor(private opts: RegistryOptions) {
    this.labels = opts.labels ?? LABELS.en;
    this.teacherTitles = opts.teacherRoleTitles.map((t) => t.toLowerCase());
  }

  /** Changes whenever names or displays change (→ rebuild the name dictionary). */
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

  /** Registers a person or adds names/role hints to a known one. */
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

  private hintFromTitle(title: string | null | undefined): RoleHint {
    const t = clean(title)?.toLowerCase();
    if (!t) return "none";
    return this.teacherTitles.some((x) => t.includes(x)) ? "teacher" : "student";
  }

  /** Message thread participant: role from RoleInHierarchyTitle. */
  registerParticipant(p: ApiParticipant) {
    this.register(
      p.PersonId,
      { firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName },
      this.hintFromTitle(p.RoleInHierarchyTitle),
    );
  }

  /** Course participant: only FullName + role (course profile) → split first/last name heuristically. */
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
    this.register(p.PersonId, { fullName: full, firstName, lastName }, this.hintFromTitle(p.Role));
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

  /** Display of a person. Unknown ids without data → "Person-XXXX". */
  resolve(id: number | null | undefined): Person {
    const L = this.labels;
    const role = this.role(id);
    if (typeof id !== "number") return { display: L.unknown, role: "unknown" };
    if (role === "self") return { display: L.self, role };
    const short = this.shortId(id);
    if (role === "teacher") {
      if (this.opts.redactTeachers) return { display: L.teacherPseudonym(short), role };
      const entry = this.opts.teachers.get(this.teacherKey(id));
      const last = entry?.lastName || this.persons.get(id)?.names.lastName;
      if (!last) return { display: L.teacherPseudonym(short), role };
      return { display: entry?.salutation ? L.teacherWithSalutation(entry.salutation, last) : L.teacher(last), role };
    }
    if (role === "student") return { display: L.student(short), role };
    return { display: L.person(short), role };
  }

  /** All known people with names + display – the basis of the name dictionary. */
  dictionaryEntries(): { names: PersonNames; display: string; withTitles: boolean }[] {
    return [...this.persons.values()].map((r) => {
      const p = this.resolve(r.id);
      return { names: r.names, display: p.display, withTitles: p.role === "teacher" };
    });
  }

  private hmac(id: number) {
    return createHmac("sha256", this.opts.secret).update(`${this.opts.baseUrl}|${id}`).digest("hex").toUpperCase();
  }

  /** Stable key for teachers.json (8 hex chars, no PersonId). */
  teacherKey(id: number) {
    return this.hmac(id).slice(0, 8);
  }

  /** Short pseudonym (4 chars, 6 on collision). */
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
