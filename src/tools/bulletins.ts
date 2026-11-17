import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiLightBulletin } from "../api/types";
import type { AppContext } from "../context";
import { type FileRefDto, formatRef } from "../files/refs";
import { log } from "../log";
import type { Person } from "../redaction/registry";
import { isShareableUrl } from "../redaction/secrets";
import { registerPublishedBy, warmCourse } from "./people";
import { handler, ok } from "./result";

const TEXT_LEN = 4_000;

export type BulletinDto = {
  id: number;
  published: string | null;
  activeUntil: string | null;
  author: Person | null;
  text: string;
  pinned: boolean;
  link?: string;
  images: FileRefDto[];
  resources: { elementId: number; title: string; type: string; fileRef: string }[];
  commentsCount: number;
};

/** Images of a bulletin → fileRefs (the tokenized URL stays inside the FileService). */
export function bulletinImages(ctx: AppContext, courseId: number | undefined, b: ApiLightBulletin): FileRefDto[] {
  if (!courseId) return [];
  return (b.AttachedImages ?? []).flatMap((img, index) => {
    if (!img?.OriginalFileUrl) return [];
    const fileRef = formatRef({ kind: "bulletinImage", courseId, bulletinId: b.LightBulletinId, index });
    ctx.files.remember(fileRef, img.OriginalFileUrl);
    return [{ fileRef, name: ctx.redactor.labels.imageN(index + 1), kind: "image" as const }];
  });
}

export const listBulletinsInput = {
  courseId: z.number().int().positive().describe("courseId from itslearning_list_courses"),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
  includeResources: z.boolean().default(true).describe("Also load attached resources (title + elementId)"),
};
type ListBulletinsArgs = { courseId: number; limit?: number; offset?: number; includeResources?: boolean };

export async function listBulletins(ctx: AppContext, args: ListBulletinsArgs) {
  const limit = args.limit ?? 10;
  const offset = args.offset ?? 0;
  // itslearning pages via PageIndex → map the offset onto pages of size `limit`
  const pageIndex = Math.floor(offset / limit);
  const [res] = await Promise.all([ctx.it.courseBulletins(args.courseId, pageIndex, limit), warmCourse(ctx, args.courseId)]);
  const items = res.EntityArray ?? [];
  for (const b of items) registerPublishedBy(ctx.redactor.people, b.PublishedBy, "teacher-weak");

  const bulletins: BulletinDto[] = [];
  for (const b of items) {
    let resources: BulletinDto["resources"] = [];
    if ((args.includeResources ?? true) && b.HasResources) {
      try {
        resources = (await ctx.it.bulletinElements(b.LightBulletinId)).map((e) => ({
          elementId: e.ElementId,
          title: ctx.redactor.title(e.Title),
          type: e.ElementType ?? "Unknown",
          fileRef: formatRef({ kind: "element", elementId: e.ElementId }),
        }));
      } catch {
        log.warn("Could not load bulletin resources");
      }
    }
    const link = b.EmbedUrl && isShareableUrl(b.EmbedUrl) ? b.EmbedUrl : undefined;
    bulletins.push({
      id: b.LightBulletinId,
      published: b.PublishedDate ?? null,
      activeUntil: b.ActiveToDate ?? null,
      author: b.PublishedBy ? ctx.redactor.people.resolve(b.PublishedBy.PersonId) : null,
      text: ctx.redactor.text(b.Text, TEXT_LEN),
      pinned: b.Pinned ?? false,
      ...(link ? { link } : {}),
      images: bulletinImages(ctx, args.courseId, b),
      resources,
      commentsCount: b.CommentsCount ?? 0,
    });
  }
  const total = res.Total ?? bulletins.length;
  return { bulletins, total, hasMore: pageIndex * limit + items.length < total };
}

export function registerBulletinTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_bulletins",
    {
      title: "Course announcements",
      description:
        "Announcements (bulletins) of a course, newest first, with attached resources (elementId/fileRef). External links are kept; itslearning-internal links and person names are redacted.",
      inputSchema: listBulletinsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_bulletins", async (args: ListBulletinsArgs) => {
      const data = await listBulletins(ctx, args);
      return ok(`${data.bulletins.length} of ${data.total} announcements.`, data);
    }),
  );
}
