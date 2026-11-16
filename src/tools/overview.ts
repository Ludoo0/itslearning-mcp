import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context";
import { log } from "../log";
import { isUnread, toThreadDto } from "./messages";
import { isoDate, listNews } from "./news";
import { registerThread } from "./people";
import { handler, ok } from "./result";
import { listTasks } from "./tasks";

export const overviewInput = {
  days: z.number().int().min(1).max(30).default(7).describe("Zeitraum in Tagen: fällige Aufgaben voraus, Neuigkeiten zurück"),
  newsSince: isoDate.optional().describe("Neuigkeiten ab diesem Zeitpunkt (Standard: vor `days` Tagen)"),
};
type OverviewArgs = { days?: number; newsSince?: string };

export async function overview(ctx: AppContext, args: OverviewArgs) {
  const days = args.days ?? 7;
  const since = args.newsSince ?? new Date(ctx.now().getTime() - days * 86_400_000).toISOString();

  // Threads zuerst: deren Teilnehmer füllen das Namens-Wörterbuch für die Texte von Aufgaben/Neuigkeiten
  const threads = await ctx.it.messageThreads(50).catch(() => {
    log.warn("Nachrichten für Übersicht nicht verfügbar");
    return undefined;
  });
  const allThreads = threads?.Threads?.EntityArray ?? [];
  for (const t of allThreads) registerThread(ctx.redactor.people, t);
  const unread = allThreads.filter(isUnread);

  const [tasks, news] = await Promise.all([
    listTasks(ctx, { status: "open", dueWithinDays: days, limit: 100 }),
    listNews(ctx, { since, limit: 15 }),
  ]);

  return {
    period: { days, newsSince: since },
    overdue: tasks.tasks.filter((t) => t.overdue),
    dueSoon: tasks.tasks.filter((t) => !t.overdue),
    news: news.items,
    unreadThreads: unread.length,
    unreadThreadsPreview: unread.slice(0, 5).map((t) => {
      const d = toThreadDto(ctx, t);
      return { threadId: d.threadId, title: d.title, lastMessage: d.lastMessage };
    }),
  };
}

export function registerOverviewTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_overview",
    {
      title: "Überblick",
      description:
        "Einstieg: überfällige und demnächst fällige Aufgaben, aktuelle Neuigkeiten und ungelesene Nachrichten auf einen Blick. Für Details die jeweiligen Tools nutzen (get_task, list_news, get_message_thread).",
      inputSchema: overviewInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_overview", async (args: OverviewArgs) => {
      const d = await overview(ctx, args);
      return ok(
        `Überfällig: ${d.overdue.length} · fällig in ${d.period.days} Tagen: ${d.dueSoon.length} · Neuigkeiten: ${d.news.length} · ungelesene Unterhaltungen: ${d.unreadThreads}.`,
        d,
      );
    }),
  );
}
