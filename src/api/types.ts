/**
 * Types of the itslearning API – only the fields the server uses.
 * Structure verified in docs/itslearning-api.md. Everything is modeled optional/nullable
 * because the API omits fields depending on the element.
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
  /** Children of a parent account (deprecated by itslearning in favour of children/v1; empty for students). */
  Children?: ApiChild[] | null;
};

/**
 * Child of a parent account (children/v1 → ChildV2, person/v1 → Child). Fields per the public API help pages.
 * EXPERIMENTAL: not verified against a real parent account.
 */
export type ApiChild = {
  PersonId: number;
  FirstName?: string | null;
  LastName?: string | null;
  FullName?: string | null;
  /** Never returned to agents (identifies the school). */
  School?: string | null;
};

/** Teacher of a child's course (PersonSimpleWithHierarchyExtendedRole). EXPERIMENTAL, unverified. */
export type ApiChildCourseTeacher = {
  PersonId: number;
  FirstName?: string | null;
  LastName?: string | null;
  FullName?: string | null;
};

/** Course of a child (children/{childId}/courses/v1 → ChildCourse). EXPERIMENTAL, unverified. */
export type ApiChildCourse = {
  CourseId: number;
  Title: string;
  CourseCode?: string | null;
  FriendlyName?: string | null;
  Teachers?: ApiChildCourseTeacher[] | null;
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

/** Element from /courses/cards/starred/v1 – field names as for courses (CourseId). */
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
  /** Web page of the task (used as fallback when the assignment API refuses details). Never returned to agents. */
  Url?: string | null;
  ContentUrl?: string | null;
};

/** Person object in PublishedBy (stream, news feed, bulletins). */
export type ApiPublishedBy = {
  PersonId: number;
  FirstName?: string | null;
  LastName?: string | null;
  FullName?: string | null;
};

export type ApiImage = {
  PreviewFileId?: number;
  PreviewFileUrl?: string | null;
  OriginalFileId?: number;
  OriginalFileUrl?: string | null;
};

export type ApiLightBulletin = {
  LightBulletinId: number;
  Text?: string | null;
  EmbedUrl?: string | null;
  Pinned?: boolean;
  AllowComments?: boolean;
  HasResources?: boolean;
  AttachedImages?: ApiImage[] | null;
  ResourcesCount?: number;
  CommentsCount?: number;
  ActiveFromDate?: string | null;
  ActiveToDate?: string | null;
  PublishedDate?: string | null;
  PublishedBy?: ApiPublishedBy | null;
};

/** Entry from notifications/stream/v2 or courses/{id}/stream/v1. */
export type ApiNotification = {
  NotificationId: number;
  Text?: string | null;
  LocationTitle?: string | null;
  PublishedDate?: string | null;
  PublishedBy?: ApiPublishedBy | null;
  ElementId?: number | null;
  ElementType?: string | null;
  ElementsCount?: number;
  LightBulletin?: ApiLightBulletin | null;
  LocationType?: string | null;
  LocationId?: number | null;
};

/** Element (e.g. a resource attached to a bulletin). */
export type ApiElement = {
  ElementId: number;
  ElementType?: string | null;
  Title?: string | null;
  LearningToolId?: number | null;
  Homework?: boolean;
};

export type ApiParticipant = {
  PersonId: number;
  FirstName?: string | null;
  LastName?: string | null;
  FullName?: string | null;
  RoleInHierarchyTitle?: string | null;
  RoleInHierarchy?: number | null;
  IsDeleted?: boolean;
};

export type ApiMessage = {
  MessageId: number;
  InstantMessageThreadId?: number;
  Created?: string | null;
  CreatedBy?: number | null;
  CreatedByName?: string | null;
  CreatedByShortName?: string | null;
  Text?: string | null;
  AttachmentUrl?: string | null;
  AttachmentName?: string | null;
  Link?: string | null;
  LinkTitle?: string | null;
  IsSystemMessage?: boolean;
  IsDeleted?: boolean;
  IsEdited?: boolean;
};

export type ApiThread = {
  InstantMessageThreadId: number;
  Name?: string | null;
  Created?: string | null;
  CreatedByTeacher?: boolean;
  CreatedBy?: number | null;
  Type?: string | null;
  Messages?: Paged<ApiMessage> | null;
  LastMessage?: ApiMessage | null;
  Participants?: ApiParticipant[] | null;
  ParticipantsCount?: number;
  LocationRecipients?: { Title?: string | null; Type?: number | string | null }[] | null;
  LastReadInstantMessageId?: number | null;
  SortIndex?: number | null;
};

export type ApiThreadList = { Threads: Paged<ApiThread>; HasMore?: boolean };
export type ApiThreadMessages = { Messages: Paged<ApiMessage> };

/** Course participant (courses/{id}/participants/v1) – per API docs; verified against a real instance. */
export type ApiCourseParticipant = {
  PersonId: number;
  FullName?: string | null;
  Role?: string | null;
  RoleId?: number | null;
};

/** Course resource (courses/{id}/resources/v1, folders/{id}/resources/v1, courses/resources/{id}/v1). */
export type ApiResource = {
  ElementId: number;
  Title?: string | null;
  ElementType?: string | null;
  CourseId?: number;
  Url?: string | null;
  ContentUrl?: string | null;
  Active?: boolean;
  Homework?: boolean;
  Path?: string | null;
  LearningToolId?: number | null;
  /** Icon URL; its ExtensionId query parameter identifies the element type (see scripts/dev/element-types.ts). */
  IconUrl?: string | null;
  LearningObjectId?: number | null;
  LearningObjectInstanceId?: number | null;
  IsTopicOrPlanFolder?: boolean;
};
export type ApiResourceList = { Resources: Paged<ApiResource> };

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

// ---------- Calendar and planner ----------
// Field names from the public API help pages (resource models CalendarEventV2, CalendarEvent,
// PlanPreview, PlanWithObjectivesAndElements). The endpoints answer at a real instance, but these
// shapes are UNVERIFIED against real data (no instance with calendar/planner content seen yet).

/** calendar/events/v1 (CalendarEventV2). EventType: Course | Project | Personal | Hierarchy. */
export type ApiCalendarEvent = {
  EventId: number;
  FromDate?: string | null;
  ToDate?: string | null;
  EventTitle?: string | null;
  Description?: string | null;
  ImportDescription?: string | null;
  EventType?: string | null;
  LocationId?: number | null;
  LocationTitle?: string | null;
};

/** courses/{courseId}/calendarevents/v1 (CalendarEvent). */
export type ApiCourseCalendarEvent = {
  Id: number;
  FromDate?: string | null;
  ToDate?: string | null;
  EventTitle?: string | null;
  Description?: string | null;
  ImportDescription?: string | null;
  CourseId?: number | null;
  LocationTitle?: string | null;
};

/** planner/v1 (PlanPreview). LocationType: Course | Project. Start/Stop are null if not set. */
export type ApiPlanPreview = {
  PlanId: number;
  TopicId?: number | null;
  Order?: number | null;
  LocationId?: number | null;
  LocationType?: string | null;
  LocationTitle?: string | null;
  PlanName?: string | null;
  PlanDescription?: string | null;
  Start?: string | null;
  Stop?: string | null;
  ClassHours?: number | null;
};

/** planner/plansinfo/v1 (PlanWithObjectivesAndElements) – CoursePlannerUrl and IconUri are deliberately not modeled. */
export type ApiPlanInfo = {
  PlanId: number;
  CourseId?: number | null;
  CourseName?: string | null;
  PlanTopicName?: string | null;
  PlanTitle?: string | null;
  PlanDescription?: string | null;
  PlanStartDateTime?: string | null;
  PlanEndDateTime?: string | null;
  LearningObjectives?: { Id?: number; Title?: string | null; Description?: string | null }[] | null;
  /** Type: ElementType enum name (e.g. LearningToolElement, Assignment, FolderFile). */
  Elements?: { Id: number; Title?: string | null; Type?: string | null; IsMarkedAsHomework?: boolean }[] | null;
};
