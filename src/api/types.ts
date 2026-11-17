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
};

/** Person-Objekt in PublishedBy (Stream, Newsfeed, Bulletins). */
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
