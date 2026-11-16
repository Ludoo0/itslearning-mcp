/**
 * Typen der itslearning-API – nur die Felder, die der Server nutzt.
 * Struktur verifiziert in docs/itslearning-api.md. Alles ist optional/nullable modelliert,
 * weil die API Felder je nach Element weglässt.
 */

export type Paged<T> = {
  EntityArray: T[];
  Total: number;
  CurrentPageIndex: number;
  PageSize: number;
};

export type ApiPerson = {
  PersonId: number;
  FirstName?: string | null;
  LastName?: string | null;
  FullName?: string | null;
  Language?: string | null;
  TimeZoneId?: string | null;
  CanAccessCourses?: boolean;
  CanAccessMessageSystem?: boolean;
  CanAccessInstantMessageSystem?: boolean;
};

export type ApiCourse = {
  CourseId: number;
  Title: string;
  CourseCode?: string | null;
  LastUpdatedUtc?: string | null;
  NewNotificationsCount?: number;
  NewBulletinsCount?: number;
  HasStudentPermissions?: boolean;
  HasAdminPermissions?: boolean;
};

/** Element aus /courses/cards/starred/v1 – Feldnamen wie bei Kursen (CourseId). */
export type ApiCourseCard = { CourseId?: number; Id?: number };

export type ApiTask = {
  TaskId: number;
  Title: string;
  Description?: string | null;
  LocationTitle?: string | null;
  LocationType?: string | null;
  LocationId?: number | null;
  Status?: string | null;
  Deadline?: string | null;
  ElementId: number;
  ElementType?: string | null;
  LearningToolId?: number | null;
  Homework?: boolean;
};

export type ApiAssignment = {
  ElementId: number;
  Title?: string | null;
  IsHomework?: boolean;
  IsMandatory?: boolean;
  IsActive?: boolean;
  Deadline?: string | null;
  IsSubmissionAfterDeadlineAllowed?: boolean;
  SubmissionType?: string | null;
  CompletionMode?: string | null;
  Files?: unknown[] | null;
  FilesInCloud?: unknown[] | null;
  TemplateFile?: unknown | null;
  RawText?: string | null;
  Text?: string | null;
  AnswerId?: number | null;
  CanSubmitOrEditAnswer?: boolean;
  LearningObjectiveSettings?: { CourseId?: number; CourseTitle?: string | null } | null;
};
