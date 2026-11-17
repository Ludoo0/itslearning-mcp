import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LABELS } from "../src/redaction/labels";
import { Redactor } from "../src/redaction/redactor";
import { PersonRegistry, type RegistryOptions } from "../src/redaction/registry";
import { TeacherDirectory } from "../src/redaction/teachers";
import { P_STUDENT, P_TEACHER, P_UNKNOWN, SELF } from "./fixtures";

const names = (p: { FirstName: string; LastName: string; FullName: string }) => ({
  firstName: p.FirstName,
  lastName: p.LastName,
  fullName: p.FullName,
});

function registry(over: Partial<RegistryOptions> = {}) {
  return new PersonRegistry({
    secret: "s".repeat(32),
    baseUrl: "https://demo.itslearning.com",
    teachers: new TeacherDirectory(null),
    redactTeachers: false,
    teacherRoleTitles: ["Teacher", "Lehrer", "Lehrerin"],
    ...over,
  });
}

describe("PersonRegistry", () => {
  test("display per role (en)", () => {
    const r = registry();
    r.setSelf(SELF.PersonId, { firstName: SELF.FirstName, lastName: SELF.LastName });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Teacher" });
    r.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Student" });
    r.register(P_UNKNOWN.PersonId, names(P_UNKNOWN));

    expect(r.resolve(SELF.PersonId)).toEqual({ display: "Me", role: "self" });
    expect(r.resolve(P_TEACHER.PersonId)).toEqual({ display: "Teacher Lindqvist", role: "teacher" });
    expect(r.resolve(P_STUDENT.PersonId).display).toMatch(/^Student-[0-9A-F]{4}$/);
    expect(r.resolve(P_UNKNOWN.PersonId).display).toMatch(/^Person-[0-9A-F]{4}$/);
    expect(r.resolve(999).display).toMatch(/^Person-/);
    expect(r.resolve(undefined)).toEqual({ display: "Unknown", role: "unknown" });
  });

  test("display per role (de)", () => {
    const r = registry({ labels: LABELS.de });
    r.setSelf(SELF.PersonId, { firstName: SELF.FirstName });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    r.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Schüler" });
    expect(r.resolve(SELF.PersonId).display).toBe("Ich");
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Lehrkraft Lindqvist");
    expect(r.resolve(P_STUDENT.PersonId).display).toMatch(/^Schüler:in-[0-9A-F]{4}$/);
    expect(r.resolve(undefined).display).toBe("Unbekannt");
  });

  test("a weak teacher hint loses against a reliable student role", () => {
    const r = registry();
    r.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Student" });
    r.register(P_STUDENT.PersonId, {}, "teacher-weak");
    expect(r.role(P_STUDENT.PersonId)).toBe("student");
    r.register(P_UNKNOWN.PersonId, names(P_UNKNOWN), "teacher-weak");
    expect(r.role(P_UNKNOWN.PersonId)).toBe("teacher");
  });

  test("REDACT_TEACHERS → teachers are pseudonymized", () => {
    const r = registry({ redactTeachers: true });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Teacher" });
    expect(r.resolve(P_TEACHER.PersonId).display).toMatch(/^Teacher-[0-9A-F]{4}$/);
    const de = registry({ redactTeachers: true, labels: LABELS.de });
    de.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    expect(de.resolve(P_TEACHER.PersonId).display).toMatch(/^Lehrkraft-[0-9A-F]{4}$/);
  });

  test("pseudonyms: stable with the same secret, different with another one", () => {
    const a = registry().resolve(P_STUDENT.PersonId).display;
    const b = registry().resolve(P_STUDENT.PersonId).display;
    const c = registry({ secret: "t".repeat(32) }).resolve(P_STUDENT.PersonId).display;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("TeacherDirectory (teachers.json)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "itsl-teachers-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("adds teachers (without PersonId/first name) and applies the salutation without restart", async () => {
    let now = 0;
    const path = join(dir, "teachers.json");
    const teachers = new TeacherDirectory(path, () => now);
    const r = registry({ teachers });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Teacher" });

    const file = JSON.parse(await readFile(path, "utf8"));
    expect(file.teachers).toHaveLength(1);
    expect(file.teachers[0]).toMatchObject({ lastName: "Lindqvist", salutation: "" });
    expect(file._hint).toContain("salutation");
    expect(JSON.stringify(file)).not.toMatch(/Sabine|2001/);
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Teacher Lindqvist");

    file.teachers[0].salutation = "Mrs";
    await Bun.sleep(20); // mtime must change
    await writeFile(path, JSON.stringify(file));
    now += 5_000;
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Mrs Lindqvist");
  });

  test("migration: the old field 'anrede' is read and rewritten as 'salutation'", async () => {
    const path = join(dir, "teachers.json");
    const key = registry().teacherKey(P_TEACHER.PersonId);
    await writeFile(path, JSON.stringify({ _hinweis: "old", teachers: [{ id: key, lastName: "Lindqvist", anrede: "Frau" }] }));
    const r = registry({ teachers: new TeacherDirectory(path), labels: LABELS.de });
    r.register(P_TEACHER.PersonId, names(P_TEACHER));
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Frau Lindqvist");
    const file = JSON.parse(await readFile(path, "utf8"));
    expect(file.teachers[0]).toEqual({ id: key, lastName: "Lindqvist", salutation: "Frau" });
    expect(file._hinweis).toBeUndefined();
  });

  test("a teacher stays a teacher across restarts (file as memory)", async () => {
    const path = join(dir, "teachers.json");
    registry({ teachers: new TeacherDirectory(path) }).registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Teacher" });
    const r2 = registry({ teachers: new TeacherDirectory(path) });
    r2.register(P_TEACHER.PersonId, names(P_TEACHER)); // without role hint
    expect(r2.role(P_TEACHER.PersonId)).toBe("teacher");
  });

  test("a broken file is never overwritten", async () => {
    const path = join(dir, "teachers.json");
    await writeFile(path, "{ broken");
    const r = registry({ teachers: new TeacherDirectory(path) });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Teacher" });
    expect(await readFile(path, "utf8")).toBe("{ broken");
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Teacher Lindqvist");
  });
});

describe("Redactor + registry", () => {
  test("free text: teacher with salutation variants, student pseudonymized, dictionary updates itself", () => {
    const red = new Redactor(registry());
    red.registerSelf(SELF);
    expect(red.text("Sabine Lindqvist and Mia Sonnenfeld")).toBe("Sabine Lindqvist and Mia Sonnenfeld"); // not registered yet
    red.people.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Teacher" });
    red.people.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Student" });
    const out = red.text("Sabine Lindqvist says: Mrs Lindqvist, Frau Lindqvist, Mia and Sonnenfeld, Jonas!");
    const mia = red.people.resolve(P_STUDENT.PersonId).display;
    expect(out).toBe(`Teacher Lindqvist says: Teacher Lindqvist, Teacher Lindqvist, ${mia} and ${mia}, Me!`);
  });

  test("German labels end to end", () => {
    const red = new Redactor(registry({ labels: LABELS.de }));
    red.registerSelf(SELF);
    red.people.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    expect(red.text("Hallo Jonas, Frau Lindqvist: a@b.example")).toBe("Hallo Ich, Lehrkraft Lindqvist: [E-Mail]");
  });
});
