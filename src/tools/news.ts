import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiNotification } from "../api/types";
import type { AppContext } from "../context";
import { type FileRefDto, formatRef } from "../files/refs";
import type { Person } from "../redaction/registry";
import { bulletinImages } from "./bulletins";
import { registerPublishedBy, warmCourses } from "./people";
import { handler, ok } from "./result";

const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const TEXT_LEN = 2_000;

export type NewsItem = {
  id: number;
  published: string | null;
  course: string;
  courseId?: number;
  author: Person | null;
  text: string;
  kind: "bulletin" | "element" | "other";
  elementId?: number;
  elementType?: string;
  bulletinId?: number;
  images?: FileRefDto[];
  /** For kind=element: reference for itslearning_download_file (if the element is a file). */
  fileRef?: string;
};

export const isoDate = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)), "ISO date expected, e.g. 2026-11-01 or 2026-11-01T08:00:00Z");

export const listNewsInput = {
  courseId: z.number().int().positive().optional().describe("Only news of this course"),
  since: isoDate.optional().describe("Only news from this point in time on (ISO date)"),
  limit: z.number().int().min(1).max(100).default(20),
};
type ListNewsArgs = { courseId?: number; since?: string; limit?: number };

export function toNewsItem(ctx: AppContext, n: ApiNotification): NewsItem {
  const lb = n.LightBulletin;
  const kind: NewsItem["kind"] = lb ? "bulletin" : n.ElementId && n.ElementType && n.ElementType !== "Unknown" ? "element" : "other";
  const authorSrc = lb?.PublishedBy ?? n.PublishedBy;
  const courseId = n.LocationId && /course/i.test(n.LocationType ?? "") ? n.LocationId : undefined;
  const images = lb ? bulletinImages(ctx, courseId, lb) : [];
  return {
    id: n.NotificationId,
    published: lb?.PublishedDate ?? n.PublishedDate ?? null,
    course: ctx.redactor.title(n.LocationTitle),
    ...(courseId ? { courseId } : {}),
    author: authorSrc ? ctx.redactor.people.resolve(authorSrc.PersonId) : null,
    text: ctx.redactor.text(lb?.Text ?? n.Text, TEXT_LEN),
    kind,
    ...(kind === "element"
      ? {
          elementId: n.ElementId!,
          elementType: n.ElementType!,
          ...(n.ElementType === "LearningToolElement" ? { fileRef: formatRef({ kind: "element", elementId: n.ElementId! }) } : {}),
        }
      : {}),
    ...(lb ? { bulletinId: lb.LightBulletinId } : {}),
    ...(images.length ? { images } : {}),
  };
}

export async function listNews(ctx: AppContext, args: ListNewsArgs) {
  const limit = args.limit ?? 20;
  const sinceMs = args.since ? Date.parse(args.since) : undefined;
  const collected: ApiNotification[] = [];
  let total = 0;
  let exhausted = false;

  for (let page = 0; page < MAX_PAGES && collected.length < limit; page++) {
    const res = args.courseId
      ? await ctx.it.courseStream(args.courseId, page, PAGE_SIZE)
      : await ctx.it.notificationStream(page, PAGE_SIZE);
    const items = res.EntityArray ?? [];
    total = res.Total ?? items.length;
    let reachedOld = false;
    for (const n of items) {
      const t = Date.parse(n.LightBulletin?.PublishedDate ?? n.PublishedDate ?? "");
      if (sinceMs !== undefined && Number.isFinite(t) && t < sinceMs) {
        reachedOld = true;
        continue;
      }
      collected.push(n);
    }
    if (reachedOld || items.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total) {
      exhausted = true;
      break;
    }
  }

  // Register all people first, then redact the texts
  for (const n of collected) {
    registerPublishedBy(ctx.redactor.people, n.PublishedBy);
    registerPublishedBy(ctx.redactor.people, n.LightBulletin?.PublishedBy, "teacher-weak");
  }
  const page = collected.slice(0, limit);
  await warmCourses(ctx, page.map((n) => (/course/i.test(n.LocationType ?? "") ? n.LocationId : undefined)));
  return { items: page.map((n) => toNewsItem(ctx, n)), hasMore: collected.length > limit || !exhausted };
}

export function registerNewsTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_news",
    {
      title: "News",
      description:
        "News feed (newest first): course announcements (bulletins), new tasks/resources and other events – optionally for one course and from a date on. People are pseudonymized; teachers appear by last name.",
      inputSchema: listNewsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_news", async (args: ListNewsArgs) => {
      const data = await listNews(ctx, args);
      return ok(`${data.items.length} news items${data.hasMore ? " (more available)" : ""}.`, data);
    }),
  );
}
