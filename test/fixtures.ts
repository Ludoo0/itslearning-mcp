/**
 * Synthetic API responses. Structure as observed against a real instance;
 * all names and content are fictional.
 */
import { Limiter } from "../src/api/limiter";
import type {
  ApiAssignment,
  ApiCourse,
  ApiElement,
  ApiLightBulletin,
  ApiMessage,
  ApiNotification,
  ApiParticipant,
  ApiPerson,
  ApiResource,
  ApiTask,
  ApiThread,
  Paged,
} from "../src/api/types";
import { type AppContext, createContext, type ItslearningApi } from "../src/context";
import { ToolError } from "../src/errors";
import type { FileCache } from "../src/files/cache";
import { FileService } from "../src/files/service";
import { LABELS, type Language } from "../src/redaction/labels";
import { Redactor } from "../src/redaction/redactor";
import { PersonRegistry } from "../src/redaction/registry";
import { TeacherDirectory } from "../src/redaction/teachers";
import { WebBrowser } from "../src/websession/browser";
import { createFakeWeb, type FakeWeb } from "./fakeWeb";

// ---------- People (all fictional) ----------
// 1001 Jonas Beispielmann – the account owner
// 2001 Sabine Lindqvist   – teacher (RoleInHierarchyTitle)
// 2002 Thomas Brandauer   – teacher (only recognizable via CreatedByTeacher)
// 3001 Mia Sonnenfeld     – student
// 4001 Karl Fremdling     – unknown role (publishes in the stream)
export const P_TEACHER = { PersonId: 2001, FirstName: "Sabine", LastName: "Lindqvist", FullName: "Sabine Lindqvist" };
export const P_TEACHER2 = { PersonId: 2002, FirstName: "Thomas", LastName: "Brandauer", FullName: "Thomas Brandauer" };
export const P_STUDENT = { PersonId: 3001, FirstName: "Mia", LastName: "Sonnenfeld", FullName: "Mia Sonnenfeld" };
export const P_UNKNOWN = { PersonId: 4001, FirstName: "Karl", LastName: "Fremdling", FullName: "Karl Fremdling" };

/** Names that must never appear in any tool output (teacher last names are allowed). */
export const FORBIDDEN_NAMES = ["Jonas", "Beispielmann", "Sabine", "Thomas", "Mia", "Sonnenfeld", "Karl", "Kid1", "Sample1"];

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
    Text: "New announcement",
    LocationTitle: "English 8b",
    LocationType: "Course",
    LocationId: 12,
    PublishedDate: "2026-11-15T09:00:00Z",
    PublishedBy: P_TEACHER,
    ElementType: "Unknown",
    LightBulletin: {
      LightBulletinId: 6001,
      Text: "<p>Dear class, please hand in to Sabine Lindqvist. Questions: lindqvist@school.example</p>",
      PublishedDate: "2026-11-15T09:00:00Z",
      PublishedBy: P_TEACHER,
      AttachedImages: [{ OriginalFileUrl: "https://filerepository.itslearning.com/abc?Token=IMGSECRET" }],
    },
  },
  {
    NotificationId: 8002,
    Text: "New task: Fractions worksheet (by Karl Fremdling)",
    LocationTitle: "Math 8b",
    LocationType: "Course",
    LocationId: 11,
    PublishedDate: "2026-11-14T09:00:00Z",
    PublishedBy: P_UNKNOWN,
    ElementId: 7001,
    ElementType: "LearningToolElement",
  },
  {
    NotificationId: 8003,
    Text: "Old info",
    LocationTitle: "Math 8b",
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
      Text: "<p>Dear class, please hand in to Sabine Lindqvist.</p>",
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
      Text: "See https://demo.itslearning.com/main.aspx?CourseID=12",
      EmbedUrl: "https://demo.itslearning.com/x",
      HasResources: false,
      PublishedDate: "2026-11-10T09:00:00Z",
      PublishedBy: P_UNKNOWN,
    },
  ],
};

export const BULLETIN_ELEMENTS: Record<number, ApiElement[]> = {
  6001: [{ ElementId: 7101, ElementType: "LearningToolElement", Title: "Reading list" }],
};

const classmates = [1, 2, 3, 4, 5].map((i) =>
  part({ PersonId: 3100 + i, FirstName: `Kid${i}`, LastName: `Sample${i}`, FullName: `Kid${i} Sample${i}` }, "Student"),
);

export const MESSAGES_9001: ApiMessage[] = [
  {
    MessageId: 501,
    Created: "2026-11-15T10:00:00Z",
    CreatedBy: 2001,
    CreatedByName: "Sabine Lindqvist",
    Text: "Hi Jonas, Mia Sonnenfeld has your notebook.",
  },
  {
    MessageId: 499,
    Created: "2026-11-14T10:00:00Z",
    CreatedBy: 1001,
    CreatedByName: "Jonas Beispielmann",
    Text: "I'll bring it tomorrow, Mrs Lindqvist.",
  },
  { MessageId: 500, Created: "2026-11-14T11:00:00Z", CreatedBy: 3001, CreatedByName: "Mia Sonnenfeld", Text: "deleted", IsDeleted: true },
  {
    MessageId: 502,
    Created: "2026-11-15T11:00:00Z",
    CreatedBy: 1001,
    CreatedByName: "Jonas Beispielmann",
    Text: "",
    AttachmentName: "Notes_Jonas_Beispielmann.pdf",
    AttachmentUrl: "https://filerepository.itslearning.com/def?Token=ATTSECRET&Download=1",
    Link: "https://example.org/video",
    LinkTitle: "Video",
  },
];

function selfPart() {
  return { PersonId: 1001, FirstName: "Jonas", LastName: "Beispielmann", FullName: "Jonas Beispielmann" };
}

export const THREADS: ApiThread[] = [
  {
    InstantMessageThreadId: 9001,
    Name: "",
    Type: "OneToOne",
    CreatedBy: 2001,
    CreatedByTeacher: true,
    Participants: [part(selfPart(), "Student"), part(P_TEACHER, "Teacher")],
    ParticipantsCount: 2,
    LastMessage: MESSAGES_9001[0],
    LastReadInstantMessageId: 499,
    SortIndex: 30,
  },
  {
    InstantMessageThreadId: 9002,
    Name: "Project with Mia Sonnenfeld",
    Type: "Group",
    CreatedBy: 2002,
    CreatedByTeacher: true,
    Participants: [part(selfPart(), "Student"), part(P_STUDENT, "Student"), part(P_TEACHER2, null)],
    ParticipantsCount: 3,
    LastMessage: {
      MessageId: 600,
      Created: "2026-11-13T10:00:00Z",
      CreatedBy: 3001,
      CreatedByName: "Mia Sonnenfeld",
      Text: "See you tomorrow!",
    },
    LastReadInstantMessageId: 600,
    SortIndex: 20,
  },
  {
    InstantMessageThreadId: 9003,
    Name: "",
    Type: "Course",
    CreatedBy: 2001,
    CreatedByTeacher: true,
    LocationRecipients: [{ Title: "English 8b", Type: 1 }],
    Participants: [part(selfPart(), "Student"), part(P_TEACHER, "Teacher"), ...classmates],
    ParticipantsCount: 7,
    LastMessage: {
      MessageId: 700,
      Created: "2026-11-12T10:00:00Z",
      CreatedBy: 2001,
      CreatedByName: "Sabine Lindqvist",
      Text: "Info for everyone",
    },
    LastReadInstantMessageId: 650,
    SortIndex: 10,
  },
  {
    // Group without name and without location → group title
    InstantMessageThreadId: 9004,
    Name: "",
    Type: "Group",
    CreatedBy: 2001,
    CreatedByTeacher: true,
    Participants: [part(selfPart(), "Student"), part(P_TEACHER, "Teacher"), ...classmates.slice(0, 4)],
    ParticipantsCount: 6,
    LastMessage: {
      MessageId: 800,
      Created: "2026-11-11T10:00:00Z",
      CreatedBy: 2001,
      CreatedByName: "Sabine Lindqvist",
      Text: "Bring headphones",
    },
    LastReadInstantMessageId: 800,
    SortIndex: 5,
  },
];

export const SELF: ApiPerson = {
  PersonId: 1001,
  FirstName: "Jonas",
  LastName: "Beispielmann",
  FullName: "Jonas Beispielmann",
  TimeZoneId: "W. Europe Standard Time",
  CanAccessCourses: true,
};

export const COURSES_V1: ApiCourse[] = [
  {
    CourseId: 11,
    Title: "Math 8b",
    CourseCode: "",
    LastUpdatedUtc: "2026-11-15T10:00:00Z",
    NewNotificationsCount: 2,
    NewBulletinsCount: 0,
    HasStudentPermissions: true,
  },
  {
    CourseId: 12,
    Title: "English 8b",
    CourseCode: "",
    LastUpdatedUtc: "2026-11-14T10:00:00Z",
    NewNotificationsCount: 0,
    NewBulletinsCount: 1,
    HasStudentPermissions: true,
  },
];
export const COURSES_V2: ApiCourse[] = [
  ...COURSES_V1,
  { CourseId: 9, Title: "Math 7b", CourseCode: "", LastUpdatedUtc: "2025-07-01T10:00:00Z", HasStudentPermissions: false },
];

export const NOW = new Date("2026-11-16T12:00:00Z");

export const TASKS: ApiTask[] = [
  {
    TaskId: 501,
    ElementId: 7001,
    Title: "Fractions worksheet",
    Description: "",
    LocationTitle: "Math 8b",
    LocationType: "Course",
    LocationId: 11,
    Status: "NotStarted",
    Deadline: "2026-11-18T07:00:00Z",
    ElementType: "LearningToolElement",
    Homework: true,
  },
  {
    TaskId: 502,
    ElementId: 7002,
    Title: "Reading log",
    Description: "Please, Jonas: read chapter 3",
    LocationTitle: "English 8b",
    LocationType: "Course",
    LocationId: 12,
    Status: "NotStarted",
    Deadline: "2026-11-10T07:00:00Z",
    ElementType: "CustomActivity",
    Homework: false,
    ContentUrl: "https://demo.itslearning.com/CustomActivity/CustomActivityOverview.aspx?CustomActivityId=7002",
  },
  {
    TaskId: 503,
    ElementId: 7003,
    Title: "Presentation",
    LocationTitle: "English 8b",
    LocationType: "Course",
    LocationId: 12,
    Status: "Completed",
    Deadline: "2026-11-01T07:00:00Z",
    ElementType: "LearningToolElement",
  },
  {
    TaskId: 504,
    ElementId: 7004,
    Title: "Project without deadline",
    LocationTitle: "Math 8b",
    LocationType: "Course",
    LocationId: 11,
    Status: "NotStarted",
    Deadline: null,
    ElementType: "LearningToolElement",
  },
  {
    // Leftover from a previous school year (inactive course)
    TaskId: 505,
    ElementId: 7005,
    Title: "Old homework",
    LocationTitle: "Math 7b",
    LocationType: "Course",
    LocationId: 9,
    Status: "NotStarted",
    Deadline: "2025-06-01T07:00:00Z",
    ElementType: "CustomActivity",
  },
  {
    // Overdue in a current course, but long ago (older than 60 days)
    TaskId: 506,
    ElementId: 7006,
    Title: "Summer task",
    LocationTitle: "Math 8b",
    LocationType: "Course",
    LocationId: 11,
    Status: "NotStarted",
    Deadline: "2026-08-01T07:00:00Z",
    ElementType: "LearningToolElement",
  },
];

export const ASSIGNMENTS: Record<number, ApiAssignment> = {
  7001: {
    ElementId: 7001,
    Title: "Fractions worksheet",
    IsHomework: true,
    IsMandatory: true,
    Deadline: "2026-11-18T07:00:00Z",
    SubmissionType: "File",
    CompletionMode: "Submission",
    IsSubmissionAfterDeadlineAllowed: false,
    Files: [{ FileId: 1, FileName: "Fractions_Jonas.txt" }],
    FilesInCloud: [],
    TemplateFile: null,
    Text:
      '<p>Hello Jonas Beispielmann,</p><p>please work on <a href="https://example.org/sheet.pdf">this sheet</a>. ' +
      "Questions to math.teacher@school.example or 0421 1234567. Internal: " +
      '<a href="https://demo.itslearning.com/main.aspx?CourseID=11">course</a> and ' +
      "https://filerepository.itslearning.com/abc?Token=SECRET123&amp;Download=1</p>",
    AnswerId: null,
    CanSubmitOrEditAnswer: true,
  },
};

const VIEW = (id: number) => `https://demo.itslearning.com/LearningToolElement/ViewLearningToolElement.aspx?LearningToolElementId=${id}`;
export const RESOURCES: Record<number, ApiResource> = {
  7300: { ElementId: 7300, Title: "Worksheets", ElementType: "Folder", CourseId: 11, Path: "Worksheets" },
  7201: {
    ElementId: 7201,
    Title: "Worksheet week 1",
    ElementType: "LearningToolElement",
    CourseId: 11,
    ContentUrl: VIEW(7201),
    Homework: true,
  },
  7202: { ElementId: 7202, Title: "Note", ElementType: "LearningToolElement", CourseId: 11, ContentUrl: VIEW(7202) },
  7203: {
    ElementId: 7203,
    Title: "Solutions",
    ElementType: "LearningToolElement",
    CourseId: 11,
    ContentUrl: VIEW(7201),
    Path: "Worksheets/Solutions",
  },
  7101: { ElementId: 7101, Title: "Reading list", ElementType: "LearningToolElement", CourseId: 12, ContentUrl: VIEW(7201) },
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
      if (!a) throw new ToolError("FORBIDDEN", "No access to this element.", 403);
      return a;
    },
    notificationStream: async (i, s) => paged(STREAM, i, s),
    courseStream: async (courseId, i, s) =>
      paged(
        STREAM.filter((n) => n.LocationId === courseId),
        i,
        s,
      ),
    courseBulletins: async (courseId, i, s) => paged(BULLETINS[courseId] ?? [], i, s),
    bulletinElements: async (id) => BULLETIN_ELEMENTS[id] ?? [],
    // itslearning reports Total = 0 for threads and messages
    messageThreads: async (pageSize) => ({ Threads: { ...paged(THREADS, 0, pageSize), Total: 0 }, HasMore: THREADS.length > pageSize }),
    threadMessages: async (threadId, pageSize) => {
      if (threadId !== 9001) throw new ToolError("NOT_FOUND", "Element not found.", 404);
      return { Messages: { ...paged(MESSAGES_9001, 0, pageSize), Total: 0 } };
    },
    courseResources: async (courseId) => (courseId === 11 ? [RESOURCES[7300]!, RESOURCES[7201]!, RESOURCES[7202]!] : []),
    folderResources: async (_c, folderId) => (folderId === 7300 ? [RESOURCES[7203]!] : []),
    resource: async (id) => {
      const r = RESOURCES[id];
      if (!r) throw new ToolError("NOT_FOUND", "Element not found.", 404);
      return r;
    },
    ssoUrl: async (target) =>
      `https://demo.itslearning.com/SSO/MobileAppLoginSso.aspx?Signature=SIG-SECRET&ReturnUrl=${encodeURIComponent(target)}`,
    courseParticipants: async (courseId) =>
      courseId === 11
        ? [
            { PersonId: 3001, FullName: "Mia Sonnenfeld", Role: "Student" },
            { PersonId: 2001, FullName: "Sabine Lindqvist", Role: "Teacher" },
          ]
        : courseId === 12
          ? [{ PersonId: 2001, FullName: "Lindqvist, Sabine", Role: "Teacher" }]
          : Promise.reject(new ToolError("FORBIDDEN", "No access to this element.", 403)),
    assignmentFileLocation: async (elementId, fileId) => {
      if (elementId === 7001 && fileId === 1) return "https://filerepository.itslearning.com/asg1?Token=ASGSECRET";
      throw new ToolError("NOT_FOUND", "Element not found.", 404);
    },
    ...overrides,
  };
}

export type FakeContextOptions = {
  web?: FakeWeb;
  cache?: FileCache;
  maxBytes?: number;
  downloadDir?: string;
  language?: Language;
  keepWords?: string[];
};

export async function fakeContext(overrides: Partial<ItslearningApi> = {}, opts: FakeContextOptions = {}): Promise<AppContext> {
  const labels = LABELS[opts.language ?? "en"];
  const people = new PersonRegistry({
    secret: "test-secret-not-for-production",
    baseUrl: "https://demo.itslearning.com",
    teachers: new TeacherDirectory(null),
    redactTeachers: false,
    teacherRoleTitles: ["Teacher", "Staff", "Lehrer", "Lehrerin", "Lehrkraft"],
    labels,
  });
  const redactor = new Redactor(people, { keepWords: new Set((opts.keepWords ?? []).map((w) => w.toLowerCase())) });
  const it = fakeApi(overrides);
  const web = opts.web ?? createFakeWeb();
  const files = new FileService(it, new WebBrowser(new Limiter(4, 0), web.fetch), {
    maxBytes: opts.maxBytes ?? 5 * 1_048_576,
    cache: opts.cache,
    labels,
  });
  const ctx = createContext({
    cfg: { baseUrl: "https://demo.itslearning.com", redactTeachers: false, downloadDir: opts.downloadDir },
    it,
    redactor,
    files,
    now: () => NOW,
  });
  await ctx.ensureReady(); // like in production: login + own account + warm-up with thread participants
  return ctx;
}
