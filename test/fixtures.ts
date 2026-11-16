/**
 * Synthetische API-Antworten. Struktur wie in probe-output/report2.json beobachtet,
 * alle Namen und Inhalte ausgedacht.
 */
import type { ApiAssignment, ApiCourse, ApiPerson, ApiTask } from "../src/api/types";
import type { AppContext, ItslearningApi } from "../src/context";
import { ToolError } from "../src/errors";
import { Redactor } from "../src/redaction/redactor";

export const SELF: ApiPerson = {
  PersonId: 1001,
  FirstName: "Jonas",
  LastName: "Beispielmann",
  FullName: "Jonas Beispielmann",
  TimeZoneId: "W. Europe Standard Time",
  CanAccessCourses: true,
};

export const COURSES_V1: ApiCourse[] = [
  { CourseId: 11, Title: "Mathematik 8b", CourseCode: "", LastUpdatedUtc: "2026-11-15T10:00:00Z", NewNotificationsCount: 2, NewBulletinsCount: 0, HasStudentPermissions: true },
  { CourseId: 12, Title: "Deutsch 8b", CourseCode: "", LastUpdatedUtc: "2026-11-14T10:00:00Z", NewNotificationsCount: 0, NewBulletinsCount: 1, HasStudentPermissions: true },
];
export const COURSES_V2: ApiCourse[] = [
  ...COURSES_V1,
  { CourseId: 9, Title: "Mathematik 7b", CourseCode: "", LastUpdatedUtc: "2025-07-01T10:00:00Z", HasStudentPermissions: false },
];

export const NOW = new Date("2026-11-16T12:00:00Z");

export const TASKS: ApiTask[] = [
  {
    TaskId: 501, ElementId: 7001, Title: "Arbeitsblatt Brüche", Description: "", LocationTitle: "Mathematik 8b",
    LocationType: "Course", LocationId: 11, Status: "NotStarted", Deadline: "2026-11-18T07:00:00Z",
    ElementType: "LearningToolElement", Homework: true,
  },
  {
    TaskId: 502, ElementId: 7002, Title: "Lesetagebuch", Description: "Bitte an Jonas: Kapitel 3 lesen",
    LocationTitle: "Deutsch 8b", LocationType: "Course", LocationId: 12, Status: "NotStarted",
    Deadline: "2026-11-10T07:00:00Z", ElementType: "CustomActivity", Homework: false,
  },
  {
    TaskId: 503, ElementId: 7003, Title: "Referat", LocationTitle: "Deutsch 8b", LocationType: "Course",
    LocationId: 12, Status: "Completed", Deadline: "2026-11-01T07:00:00Z", ElementType: "LearningToolElement",
  },
  {
    TaskId: 504, ElementId: 7004, Title: "Projekt ohne Frist", LocationTitle: "Mathematik 8b", LocationType: "Course",
    LocationId: 11, Status: "NotStarted", Deadline: null, ElementType: "LearningToolElement",
  },
];

export const ASSIGNMENTS: Record<number, ApiAssignment> = {
  7001: {
    ElementId: 7001,
    Title: "Arbeitsblatt Brüche",
    IsHomework: true,
    IsMandatory: true,
    Deadline: "2026-11-18T07:00:00Z",
    SubmissionType: "File",
    CompletionMode: "Submission",
    IsSubmissionAfterDeadlineAllowed: false,
    Files: [{ FileId: 1 }],
    FilesInCloud: [],
    TemplateFile: null,
    Text:
      '<p>Hallo Jonas Beispielmann,</p><p>bitte <a href="https://example.org/blatt.pdf">dieses Blatt</a> bearbeiten. ' +
      'Fragen an mathe.lehrkraft@schule.example oder 0421 1234567. Intern: ' +
      '<a href="https://demo.itslearning.com/main.aspx?CourseID=11">Kurs</a> und ' +
      "https://filerepository.itslearning.com/abc?Token=SECRET123&amp;Download=1</p>",
    AnswerId: null,
    CanSubmitOrEditAnswer: true,
  },
};

export function fakeApi(overrides: Partial<ItslearningApi> = {}): ItslearningApi {
  return {
    person: async () => SELF,
    courses: async (includeInactive) => (includeInactive ? COURSES_V2 : COURSES_V1),
    starredCourseIds: async () => new Set([12]),
    tasks: async () => TASKS,
    courseTasks: async (courseId) => TASKS.filter((t) => t.LocationId === courseId),
    assignment: async (id) => {
      const a = ASSIGNMENTS[id];
      if (!a) throw new ToolError("FORBIDDEN", "Kein Zugriff auf dieses Element.", 403);
      return a;
    },
    ...overrides,
  };
}

export async function fakeContext(overrides: Partial<ItslearningApi> = {}): Promise<AppContext> {
  const redactor = new Redactor();
  const it = fakeApi(overrides);
  redactor.registerSelf(await it.person());
  return {
    cfg: { baseUrl: "https://demo.itslearning.com", redactTeachers: false },
    it,
    redactor,
    ensureReady: async () => {},
    now: () => NOW,
  };
}
