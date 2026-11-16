/** Typisierte Aufrufe der verifizierten Endpunkte (docs/itslearning-api.md). */
import type { ApiClient } from "./client";
import type {
  ApiAssignment,
  ApiCourse,
  ApiCourseCard,
  ApiElement,
  ApiLightBulletin,
  ApiNotification,
  ApiPerson,
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

  /** v1 = aktuelle Kurse als Schüler:in; v2 = inkl. ehemaliger Kurse. */
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

  assignment(elementId: number): Promise<ApiAssignment> {
    return this.api.get<ApiAssignment>(`${P}/assignments/{elementId}/v1`, { elementId });
  }

  /** Neuigkeiten über alle Kurse, inkl. Light Bulletins. */
  notificationStream(pageIndex: number, pageSize: number): Promise<Paged<ApiNotification>> {
    return this.api.get(`${P}/notifications/stream/v2`, {}, { showLightBulletins: true, PageIndex: pageIndex, PageSize: pageSize });
  }

  courseStream(courseId: number, pageIndex: number, pageSize: number): Promise<Paged<ApiNotification>> {
    return this.api.get(`${P}/courses/{courseId}/stream/v1`, { courseId }, { showLightBulletins: true, PageIndex: pageIndex, PageSize: pageSize });
  }

  courseBulletins(courseId: number, pageIndex: number, pageSize: number): Promise<Paged<ApiLightBulletin>> {
    return this.api.get(`${P}/courses/{courseId}/bulletins/v1`, { courseId }, { PageIndex: pageIndex, PageSize: pageSize });
  }

  async bulletinElements(bulletinId: number): Promise<ApiElement[]> {
    return this.all<ApiElement>(`${P}/courses/bulletins/{bulletinId}/elements/v1`, { bulletinId });
  }

  /** Nachrichten-Threads (v4). `fromSortIndex` für Folgeseiten (Semantik ⏳: SortIndex des letzten Threads). */
  messageThreads(pageSize: number, fromSortIndex?: number): Promise<ApiThreadList> {
    return this.api.get(`${P}/instantmessages/messagethreads/v4`, {}, { pageSize, fromSortIndex });
  }

  /** Nachrichten eines Threads (v3). `fromId` für ältere Nachrichten (Semantik ⏳). */
  threadMessages(threadId: number, pageSize: number, fromId?: number): Promise<ApiThreadMessages> {
    return this.api.get(`${P}/instantmessages/messagethreads/{threadId}/messages/v3`, { threadId }, { pageSize, fromId });
  }

  /** Holt alle Seiten einer Paged-Liste (mit Obergrenze, damit nichts ausufert). */
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
