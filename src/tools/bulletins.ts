import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context";
import { log } from "../log";
import type { Person } from "../redaction/registry";
import { isShareableUrl } from "../redaction/secrets";
import { registerPublishedBy } from "./people";
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
  imageCount: number;
  resources: { elementId: number; title: string; type: string }[];
  commentsCount: number;
};

export const listBulletinsInput = {
  courseId: z.number().int().positive().describe("courseId aus itslearning_list_courses"),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
  includeResources: z.boolean().default(true).describe("Angehängte Ressourcen (Titel + elementId) mitladen"),
};
type ListBulletinsArgs = { courseId: number; limit?: number; offset?: number; includeResources?: boolean };

export async function listBulletins(ctx: AppContext, args: ListBulletinsArgs) {
  const limit = args.limit ?? 10;
  const offset = args.offset ?? 0;
  // itslearning paginiert über PageIndex → Offset auf Seiten der Größe `limit` abbilden
  const pageIndex = Math.floor(offset / limit);
  const res = await ctx.it.courseBulletins(args.courseId, pageIndex, limit);
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
        }));
      } catch {
        log.warn("Bulletin-Ressourcen konnten nicht geladen werden");
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
      imageCount: b.AttachedImages?.length ?? 0,
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
      title: "Kurs-Ankündigungen",
      description:
        "Ankündigungen (Bulletins) eines Kurses, neueste zuerst, mit angehängten Ressourcen (elementId). Externe Links bleiben erhalten, itslearning-interne Links und Personennamen sind geschwärzt.",
      inputSchema: listBulletinsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_bulletins", async (args: ListBulletinsArgs) => {
      const data = await listBulletins(ctx, args);
      return ok(`${data.bulletins.length} von ${data.total} Ankündigungen.`, data);
    }),
  );
}
