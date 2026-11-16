import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiNotification } from "../api/types";
import type { AppContext } from "../context";
import type { Person } from "../redaction/registry";
import { registerPublishedBy } from "./people";
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
  imageCount?: number;
};

export const isoDate = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)), "ISO-Datum erwartet, z. B. 2026-11-01 oder 2026-11-01T08:00:00Z");

export const listNewsInput = {
  courseId: z.number().int().positive().optional().describe("Nur Neuigkeiten dieses Kurses"),
  since: isoDate.optional().describe("Nur Neuigkeiten ab diesem Zeitpunkt (ISO-Datum)"),
  limit: z.number().int().min(1).max(100).default(20),
};
type ListNewsArgs = { courseId?: number; since?: string; limit?: number };

export function toNewsItem(ctx: AppContext, n: ApiNotification): NewsItem {
  const lb = n.LightBulletin;
  const kind: NewsItem["kind"] = lb ? "bulletin" : n.ElementId && n.ElementType && n.ElementType !== "Unknown" ? "element" : "other";
  const authorSrc = lb?.PublishedBy ?? n.PublishedBy;
  const images = lb?.AttachedImages?.length ?? 0;
  return {
    id: n.NotificationId,
    published: lb?.PublishedDate ?? n.PublishedDate ?? null,
    course: ctx.redactor.title(n.LocationTitle),
    ...(n.LocationId && /course/i.test(n.LocationType ?? "") ? { courseId: n.LocationId } : {}),
    author: authorSrc ? ctx.redactor.people.resolve(authorSrc.PersonId) : null,
    text: ctx.redactor.text(lb?.Text ?? n.Text, TEXT_LEN),
    kind,
    ...(kind === "element" ? { elementId: n.ElementId!, elementType: n.ElementType! } : {}),
    ...(lb ? { bulletinId: lb.LightBulletinId } : {}),
    ...(images ? { imageCount: images } : {}),
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

  // Erst alle Personen registrieren, dann Texte schwärzen
  for (const n of collected) {
    registerPublishedBy(ctx.redactor.people, n.PublishedBy);
    registerPublishedBy(ctx.redactor.people, n.LightBulletin?.PublishedBy, "teacher-weak");
  }
  const page = collected.slice(0, limit);
  return { items: page.map((n) => toNewsItem(ctx, n)), hasMore: collected.length > limit || !exhausted };
}

export function registerNewsTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_news",
    {
      title: "Neuigkeiten",
      description:
        "Neuigkeiten-Feed (neueste zuerst): Kurs-Ankündigungen (Bulletins), neue Aufgaben/Ressourcen und andere Ereignisse – optional für einen Kurs und ab einem Datum. Personen sind pseudonymisiert, Lehrkräfte erscheinen als „Frau/Herr Nachname“.",
      inputSchema: listNewsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_news", async (args: ListNewsArgs) => {
      const data = await listNews(ctx, args);
      return ok(`${data.items.length} Neuigkeiten${data.hasMore ? " (weitere vorhanden)" : ""}.`, data);
    }),
  );
}
