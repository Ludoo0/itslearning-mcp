/**
 * Synthetische API-Antworten. Struktur wie in probe-output/report2.json beobachtet,
 * alle Namen und Inhalte ausgedacht.
 */
import type {
  ApiAssignment,
  ApiCourse,
  ApiElement,
  ApiLightBulletin,
  ApiMessage,
  ApiNotification,
  ApiParticipant,
  ApiPerson,
  ApiTask,
  ApiThread,
  Paged,
} from "../src/api/types";
import type { AppContext, ItslearningApi } from "../src/context";
import { ToolError } from "../src/errors";
import { Redactor } from "../src/redaction/redactor";

// ---------- Personen (alle erfunden) ----------
// 2001 Sabine Lindqvist – Lehrkraft (RoleInHierarchyTitle)
// 2002 Thomas Brandauer – Lehrkraft (nur über CreatedByTeacher erkennbar)
// 3001 Mia Sonnenfeld   – Schülerin
// 4001 Karl Fremdling   – Rolle unbekannt (veröffentlicht im Stream)
export const P_TEACHER = { PersonId: 2001, FirstName: "Sabine", LastName: "Lindqvist", FullName: "Sabine Lindqvist" };
export const P_TEACHER2 = { PersonId: 2002, FirstName: "Thomas", LastName: "Brandauer", FullName: "Thomas Brandauer" };
export const P_STUDENT = { PersonId: 3001, FirstName: "Mia", LastName: "Sonnenfeld", FullName: "Mia Sonnenfeld" };
export const P_UNKNOWN = { PersonId: 4001, FirstName: "Karl", LastName: "Fremdling", FullName: "Karl Fremdling" };

/** Namen, die in keiner Tool-Ausgabe vorkommen dürfen (Lehrkräfte-Nachnamen sind erlaubt). */
export const FORBIDDEN_NAMES = ["Jonas", "Beispielmann", "Sabine", "Thomas", "Mia", "Sonnenfeld", "Karl", "Kind1", "Muster1"];

const part = (p: { PersonId: number; FirstName: string; LastName: string; FullName: string }, title: string | null): ApiParticipant => ({
  ...p,
  RoleInHierarchyTitle: title,
  IsDeleted: false,
});

export const paged = <T>(all: T[], pageIndex: number, pageSize: number): Paged<T> => ({
  EntityArray: all.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
  Total: all.length,
  CurrentPageIndex: pageIndex,
  PageSize: pageSize,
});

export const STREAM: ApiNotification[] = [
  {
    NotificationId: 8001,
    Text: "Neue Mitteilung",
    LocationTitle: "Deutsch 8b",
    LocationType: "Course",
    LocationId: 12,
    PublishedDate: "2026-11-15T09:00:00Z",
    PublishedBy: P_TEACHER,
    ElementType: "Unknown",
    LightBulletin: {
      LightBulletinId: 6001,
      Text: "<p>Liebe Klasse, Abgabe bei Sabine Lindqvist. Fragen: lindqvist@schule.example</p>",
      PublishedDate: "2026-11-15T09:00:00Z",
      PublishedBy: P_TEACHER,
      AttachedImages: [{ OriginalFileUrl: "https://filerepository.itslearning.com/abc?Token=IMGSECRET" }],
    },
  },
  {
    NotificationId: 8002,
    Text: "Neue Aufgabe: Arbeitsblatt Brüche (von Karl Fremdling)",
    LocationTitle: "Mathematik 8b",
    LocationType: "Course",
    LocationId: 11,
    PublishedDate: "2026-11-14T09:00:00Z",
    PublishedBy: P_UNKNOWN,
    ElementId: 7001,
    ElementType: "LearningToolElement",
  },
  {
    NotificationId: 8003,
    Text: "Alte Info",
    LocationTitle: "Mathematik 8b",
    LocationType: "Course",
    LocationId: 11,
    PublishedDate: "2026-10-01T09:00:00Z",
    PublishedBy: P_TEACHER2,
    ElementType: "Unknown",
  },
];

export const BULLETINS: Record<number, ApiLightBulletin[]> = {
  12: [
    {
      LightBulletinId: 6001,
      Text: "<p>Liebe Klasse, Abgabe bei Sabine Lindqvist.</p>",
      EmbedUrl: "https://example.org/info",
      Pinned: true,
      HasResources: true,
      ResourcesCount: 1,
      CommentsCount: 2,
      PublishedDate: "2026-11-15T09:00:00Z",
      PublishedBy: P_TEACHER,
      AttachedImages: [{ OriginalFileUrl: "https://filerepository.itslearning.com/abc?Token=IMGSECRET" }],
    },
    {
      LightBulletinId: 6002,
      Text: "Siehe https://demo.itslearning.com/main.aspx?CourseID=12",
      EmbedUrl: "https://demo.itslearning.com/x",
      HasResources: false,
      PublishedDate: "2026-11-10T09:00:00Z",
      PublishedBy: P_UNKNOWN,
    },
  ],
};

export const BULLETIN_ELEMENTS: Record<number, ApiElement[]> = {
  6001: [{ ElementId: 7101, ElementType: "LearningToolElement", Title: "Leseliste" }],
};

const classmates = [1, 2, 3, 4, 5].map((i) => part({ PersonId: 3100 + i, FirstName: `Kind${i}`, LastName: `Muster${i}`, FullName: `Kind${i} Muster${i}` }, "Schüler"));

export const MESSAGES_9001: ApiMessage[] = [
  { MessageId: 501, Created: "2026-11-15T10:00:00Z", CreatedBy: 2001, CreatedByName: "Sabine Lindqvist", Text: "Hallo Jonas, Mia Sonnenfeld hat dein Heft." },
  { MessageId: 499, Created: "2026-11-14T10:00:00Z", CreatedBy: 1001, CreatedByName: "Jonas Beispielmann", Text: "Ich bringe es morgen, Frau Lindqvist." },
  { MessageId: 500, Created: "2026-11-14T11:00:00Z", CreatedBy: 3001, CreatedByName: "Mia Sonnenfeld", Text: "gelöscht", IsDeleted: true },
  {
    MessageId: 502,
    Created: "2026-11-15T11:00:00Z",
    CreatedBy: 1001,
    CreatedByName: "Jonas Beispielmann",
    Text: "",
    AttachmentName: "Notizen_Jonas_Beispielmann.pdf",
    AttachmentUrl: "https://filerepository.itslearning.com/def?Token=ATTSECRET&Download=1",
    Link: "https://example.org/lernvideo",
    LinkTitle: "Lernvideo",
  },
];

export const THREADS: ApiThread[] = [
  {
    InstantMessageThreadId: 9001,
    Name: "",
    Type: "OneToOne",
    CreatedBy: 2001,
    CreatedByTeacher: true,
    Participants: [part({ ...SELF_PART() }, "Schüler"), part(P_TEACHER, "Lehrer")],
    ParticipantsCount: 2,
    LastMessage: MESSAGES_9001[0],
    LastReadInstantMessageId: 499,
    SortIndex: 30,
  },
  {
    InstantMessageThreadId: 9002,
    Name: "Projekt mit Mia Sonnenfeld",
    Type: "Group",
    CreatedBy: 2002,
    CreatedByTeacher: true,
    Participants: [part(SELF_PART(), "Schüler"), part(P_STUDENT, "Schüler"), part(P_TEACHER2, null)],
    ParticipantsCount: 3,
    LastMessage: { MessageId: 600, Created: "2026-11-13T10:00:00Z", CreatedBy: 3001, CreatedByName: "Mia Sonnenfeld", Text: "Bis morgen!" },
    LastReadInstantMessageId: 600,
    SortIndex: 20,
  },
  {
    InstantMessageThreadId: 9003,
    Name: "",
    Type: "Course",
    CreatedBy: 2001,
    CreatedByTeacher: true,
    LocationRecipients: [{ Title: "Deutsch 8b", Type: 1 }],
    Participants: [part(SELF_PART(), "Schüler"), part(P_TEACHER, "Lehrer"), ...classmates],
    ParticipantsCount: 7,
    LastMessage: { MessageId: 700, Created: "2026-11-12T10:00:00Z", CreatedBy: 2001, CreatedByName: "Sabine Lindqvist", Text: "Info an alle" },
    LastReadInstantMessageId: 650,
    SortIndex: 10,
  },
];

function SELF_PART() {
  return { PersonId: 1001, FirstName: "Jonas", LastName: "Beispielmann", FullName: "Jonas Beispielmann" };
}

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
    notificationStream: async (i, s) => paged(STREAM, i, s),
    courseStream: async (courseId, i, s) => paged(STREAM.filter((n) => n.LocationId === courseId), i, s),
    courseBulletins: async (courseId, i, s) => paged(BULLETINS[courseId] ?? [], i, s),
    bulletinElements: async (id) => BULLETIN_ELEMENTS[id] ?? [],
    messageThreads: async (pageSize) => ({ Threads: paged(THREADS, 0, pageSize), HasMore: THREADS.length > pageSize }),
    threadMessages: async (threadId, pageSize) => {
      if (threadId !== 9001) throw new ToolError("NOT_FOUND", "Element nicht gefunden.", 404);
      return { Messages: paged(MESSAGES_9001, 0, pageSize) };
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
