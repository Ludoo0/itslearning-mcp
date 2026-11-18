/** Typed calls of the verified endpoints (docs/itslearning-api.md). */
import { ToolError } from "../errors";
import type { ApiClient } from "./client";
import type {
  ApiAssignment,
  ApiCalendarEvent,
  ApiChild,
  ApiChildCourse,
  ApiCourse,
  ApiCourseCalendarEvent,
  ApiCourseCard,
  ApiCourseParticipant,
  ApiElement,
  ApiLightBulletin,
  ApiNotification,
  ApiPerson,
  ApiPlanInfo,
  ApiPlanPreview,
  ApiResource,
  ApiResourceList,
  ApiTask,
  ApiThreadList,
  ApiThreadMessages,
  Paged,
} from "./types";

const P = "/restapi/personal";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export class Itslearning {
  constructor(private api: ApiClient) {}

  person(): Promise<ApiPerson> {
    return this.api.get<ApiPerson>(`${P}/person/v1`, {}, {}, { ttlS: 900 });
  }

  /** v1 = current courses as a student; v2 = including former courses. */
  courses(includeInactive: boolean): Promise<ApiCourse[]> {
    return this.all<ApiCourse>(includeInactive ? `${P}/courses/v2` : `${P}/courses/v1`, {}, { ttlS: 900 });
  }

  async starredCourseIds(): Promise<Set<number>> {
    const cards = await this.all<ApiCourseCard>(`${P}/courses/cards/starred/v1`, {}, { ttlS: 900 });
    return new Set(cards.map((c) => c.CourseId ?? c.Id).filter((id): id is number => typeof id === "number"));
  }

  tasks(): Promise<ApiTask[]> {
    return this.all<ApiTask>(`${P}/tasks/v1`);
  }

  courseTasks(courseId: number): Promise<ApiTask[]> {
    return this.all<ApiTask>(`${P}/courses/{courseId}/tasks/v1`, { courseId });
  }

  // ---------- Parent accounts (EXPERIMENTAL: per the public API help pages, not verified against a real parent account) ----------

  /** Children of a parent account (empty for students). */
  children(): Promise<ApiChild[]> {
    return this.all<ApiChild>(`${P}/children/v1`, {}, { ttlS: 900 });
  }

  childCourses(childId: number): Promise<ApiChildCourse[]> {
    return this.all<ApiChildCourse>(`${P}/children/{childId}/courses/v1`, { childId }, { ttlS: 900 });
  }

  /** Per the help page: tasks of the child that are not completed and not hidden. */
  childTasks(childId: number): Promise<ApiTask[]> {
    return this.all<ApiTask>(`${P}/children/{childId}/tasks/v1`, { childId });
  }

  childCourseTasks(childId: number, courseId: number): Promise<ApiTask[]> {
    return this.all<ApiTask>(`${P}/children/{childId}/courses/{courseId}/tasks/v1`, { childId, courseId });
  }

  assignment(elementId: number): Promise<ApiAssignment> {
    // 403/404 is expected for task types the assignment API does not describe; get_task falls back to the task page
    return this.api.get<ApiAssignment>(`${P}/assignments/{elementId}/v1`, { elementId }, {}, { expectedStatuses: [403, 404] });
  }

  /** News across all courses, including light bulletins. */
  notificationStream(pageIndex: number, pageSize: number): Promise<Paged<ApiNotification>> {
    return this.api.get(`${P}/notifications/stream/v2`, {}, { showLightBulletins: true, PageIndex: pageIndex, PageSize: pageSize });
  }

  courseStream(courseId: number, pageIndex: number, pageSize: number): Promise<Paged<ApiNotification>> {
    return this.api.get(
      `${P}/courses/{courseId}/stream/v1`,
      { courseId },
      { showLightBulletins: true, PageIndex: pageIndex, PageSize: pageSize },
    );
  }

  courseBulletins(courseId: number, pageIndex: number, pageSize: number): Promise<Paged<ApiLightBulletin>> {
    return this.api.get(`${P}/courses/{courseId}/bulletins/v1`, { courseId }, { PageIndex: pageIndex, PageSize: pageSize });
  }

  async bulletinElements(bulletinId: number): Promise<ApiElement[]> {
    return this.all<ApiElement>(`${P}/courses/bulletins/{bulletinId}/elements/v1`, { bulletinId });
  }

  /** Message threads (v4). `fromSortIndex` for further pages (semantics ⏳: SortIndex of the last thread). */
  messageThreads(pageSize: number, fromSortIndex?: number): Promise<ApiThreadList> {
    return this.api.get(`${P}/instantmessages/messagethreads/v4`, {}, { pageSize, fromSortIndex });
  }

  /** Messages of a thread (v3). `fromId` for older messages (semantics ⏳). */
  threadMessages(threadId: number, pageSize: number, fromId?: number): Promise<ApiThreadMessages> {
    return this.api.get(`${P}/instantmessages/messagethreads/{threadId}/messages/v3`, { threadId }, { pageSize, fromId });
  }

  /** Participants of a course – only for the name dictionary (redaction), never for output. */
  courseParticipants(courseId: number): Promise<ApiCourseParticipant[]> {
    return this.all<ApiCourseParticipant>(`${P}/courses/{courseId}/participants/v1`, { courseId }, { ttlS: 900 });
  }

  /** Content of a course root folder. */
  async courseResources(courseId: number): Promise<ApiResource[]> {
    const res = await this.api.get<ApiResourceList>(
      `${P}/courses/{courseId}/resources/v1`,
      { courseId },
      { PageIndex: 0, PageSize: PAGE_SIZE },
    );
    return res.Resources?.EntityArray ?? [];
  }

  async folderResources(courseId: number, folderId: number): Promise<ApiResource[]> {
    const res = await this.api.get<ApiResourceList>(
      `${P}/courses/{courseId}/folders/{folderId}/resources/v1`,
      { courseId, folderId },
      { PageIndex: 0, PageSize: PAGE_SIZE },
    );
    return res.Resources?.EntityArray ?? [];
  }

  /** Single resource including ContentUrl (starting point of the download flow). */
  resource(elementId: number): Promise<ApiResource> {
    return this.api.get<ApiResource>(`${P}/courses/resources/{resourceId}/v1`, { resourceId: elementId });
  }

  /** Short-lived SSO URL into the web interface (SECRET – never return/log). Not cached. */
  async ssoUrl(url: string): Promise<string> {
    const res = await this.api.get<{ Url?: string }>(`${P}/sso/url/v1`, {}, { url }, { ttlS: 0 });
    if (!res.Url) throw new ToolError("UPSTREAM_ERROR", "itslearning did not return a login URL.");
    return res.Url;
  }

  /** Target URL of a task attachment (SECRET). */
  assignmentFileLocation(elementId: number, fileId: number): Promise<string> {
    return this.api.getRedirectLocation(`${P}/assignments/{elementId}/files/{fileId}/v1`, { elementId, fileId });
  }

  // ---------- Calendar and planner (endpoints answer; response shapes unverified against real data) ----------

  /** Calendar events across all courses from `fromDate` (YYYY-MM-DD) on. `fromDate` is required (400 without it). */
  calendarEvents(fromDate: string, pageIndex: number, pageSize: number): Promise<Paged<ApiCalendarEvent>> {
    return this.api.get(`${P}/calendar/events/v1`, {}, { fromDate, PageIndex: pageIndex, PageSize: pageSize });
  }

  courseCalendarEvents(
    courseId: number,
    fromDate: string,
    toDate: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<Paged<ApiCourseCalendarEvent>> {
    return this.api.get(
      `${P}/courses/{courseId}/calendarevents/v1`,
      { courseId },
      { fromDate, toDate, PageIndex: pageIndex, PageSize: pageSize },
    );
  }

  /** Plan previews of a course that start or end within the period (UTC, `YYYY-MM-DDTHH:MM:SS`). */
  async coursePlans(courseId: number, startDate: string, stopDate: string): Promise<ApiPlanPreview[]> {
    const res = await this.api.get<Paged<ApiPlanPreview>>(`${P}/planner/v1`, {}, { courseId, startDate, stopDate });
    return Array.isArray(res?.EntityArray) ? res.EntityArray : [];
  }

  /** Plan details (topic, learning objectives, attached elements) for the given plan ids. */
  async plansInfo(planIds: number[]): Promise<ApiPlanInfo[]> {
    if (!planIds.length) return [];
    const query = Object.fromEntries(planIds.map((id, i) => [`plansIds[${i}]`, id]));
    const res = await this.api.get<ApiPlanInfo[]>(`${P}/planner/plansinfo/v1`, {}, query);
    return Array.isArray(res) ? res : [];
  }

  /** Fetches all pages of a paged list (with an upper bound so nothing gets out of hand). */
  private async all<T>(template: string, params: Record<string, string | number> = {}, opts: { ttlS?: number } = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.api.get<Paged<T>>(template, params, { PageIndex: page, PageSize: PAGE_SIZE }, opts);
      const items = Array.isArray(res?.EntityArray) ? res.EntityArray : [];
      out.push(...items);
      if (items.length < PAGE_SIZE || out.length >= (res.Total ?? 0)) break;
    }
    return out;
  }
}
