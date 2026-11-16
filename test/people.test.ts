import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redactor } from "../src/redaction/redactor";
import { PersonRegistry, type RegistryOptions } from "../src/redaction/registry";
import { TeacherDirectory } from "../src/redaction/teachers";
import { P_STUDENT, P_TEACHER, P_UNKNOWN, SELF } from "./fixtures";

const names = (p: { FirstName: string; LastName: string; FullName: string }) => ({ firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName });

function registry(over: Partial<RegistryOptions> = {}) {
  return new PersonRegistry({
    secret: "s".repeat(32),
    baseUrl: "https://demo.itslearning.com",
    teachers: new TeacherDirectory(null),
    redactTeachers: false,
    teacherRoleTitles: ["Lehrer", "Lehrerin"],
    ...over,
  });
}

describe("PersonRegistry", () => {
  test("Anzeigen je Rolle", () => {
    const r = registry();
    r.setSelf(SELF.PersonId, { firstName: SELF.FirstName, lastName: SELF.LastName });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrerin" });
    r.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Schüler" });
    r.register(P_UNKNOWN.PersonId, names(P_UNKNOWN));

    expect(r.resolve(SELF.PersonId)).toEqual({ display: "Ich", role: "self" });
    expect(r.resolve(P_TEACHER.PersonId)).toEqual({ display: "Lehrkraft Lindqvist", role: "teacher" });
    expect(r.resolve(P_STUDENT.PersonId).display).toMatch(/^Schüler:in-[0-9A-F]{4}$/);
    expect(r.resolve(P_UNKNOWN.PersonId).display).toMatch(/^Person-[0-9A-F]{4}$/);
    expect(r.resolve(999).display).toMatch(/^Person-/);
  });

  test("schwaches Lehrkraft-Indiz verliert gegen belastbare Schüler-Rolle", () => {
    const r = registry();
    r.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Schüler" });
    r.register(P_STUDENT.PersonId, {}, "teacher-weak");
    expect(r.role(P_STUDENT.PersonId)).toBe("student");
    r.register(P_UNKNOWN.PersonId, names(P_UNKNOWN), "teacher-weak");
    expect(r.role(P_UNKNOWN.PersonId)).toBe("teacher");
  });

  test("REDACT_TEACHERS → Lehrkräfte pseudonymisiert", () => {
    const r = registry({ redactTeachers: true });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    expect(r.resolve(P_TEACHER.PersonId).display).toMatch(/^Lehrkraft-[0-9A-F]{4}$/);
  });

  test("Pseudonyme: stabil bei gleichem Secret, anders bei anderem", () => {
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

  test("legt Lehrkräfte an (ohne PersonId/Vorname), übernimmt Anrede ohne Neustart", async () => {
    let now = 0;
    const path = join(dir, "teachers.json");
    const teachers = new TeacherDirectory(path, () => now);
    const r = registry({ teachers });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });

    const file = JSON.parse(await readFile(path, "utf8"));
    expect(file.teachers).toHaveLength(1);
    expect(file.teachers[0]).toMatchObject({ lastName: "Lindqvist", anrede: "" });
    expect(JSON.stringify(file)).not.toMatch(/Sabine|2001/);
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Lehrkraft Lindqvist");

    file.teachers[0].anrede = "Frau";
    await Bun.sleep(20); // mtime muss sich ändern
    await writeFile(path, JSON.stringify(file));
    now += 5_000;
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Frau Lindqvist");
  });

  test("Lehrkraft bleibt Lehrkraft über Neustarts (Datei als Gedächtnis)", async () => {
    const path = join(dir, "teachers.json");
    registry({ teachers: new TeacherDirectory(path) }).registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    const r2 = registry({ teachers: new TeacherDirectory(path) });
    r2.register(P_TEACHER.PersonId, names(P_TEACHER)); // ohne Rollen-Hinweis
    expect(r2.role(P_TEACHER.PersonId)).toBe("teacher");
  });

  test("kaputte Datei wird nicht überschrieben", async () => {
    const path = join(dir, "teachers.json");
    await writeFile(path, "{ kaputt");
    const r = registry({ teachers: new TeacherDirectory(path) });
    r.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    expect(await readFile(path, "utf8")).toBe("{ kaputt");
    expect(r.resolve(P_TEACHER.PersonId).display).toBe("Lehrkraft Lindqvist");
  });
});

describe("Redactor + Registry", () => {
  test("Freitext: Lehrkraft mit Anrede-Varianten, Schüler:in pseudonymisiert, Wörterbuch aktualisiert sich", () => {
    const red = new Redactor(registry());
    red.registerSelf(SELF);
    expect(red.text("Sabine Lindqvist und Mia Sonnenfeld")).toBe("Sabine Lindqvist und Mia Sonnenfeld"); // noch nicht registriert
    red.people.registerParticipant({ ...P_TEACHER, RoleInHierarchyTitle: "Lehrer" });
    red.people.registerParticipant({ ...P_STUDENT, RoleInHierarchyTitle: "Schüler" });
    const out = red.text("Sabine Lindqvist sagt: Frau Lindqvist, Herr Lindqvist, Mia und Sonnenfeld, Jonas!");
    const mia = red.people.resolve(P_STUDENT.PersonId).display;
    expect(out).toBe(`Lehrkraft Lindqvist sagt: Lehrkraft Lindqvist, Lehrkraft Lindqvist, ${mia} und ${mia}, Ich!`);
  });
});
