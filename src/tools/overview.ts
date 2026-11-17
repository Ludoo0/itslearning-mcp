import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context";
import { log } from "../log";
import { isUnread, toThreadDto } from "./messages";
import { isoDate, listNews } from "./news";
import { registerThread } from "./people";
import { handler, ok } from "./result";
import { activeCourseIds, deadlineMs, listTasks } from "./tasks";

export const overviewInput = {
  days: z.number().int().min(1).max(30).default(7).describe("Time window in days: tasks due ahead, news back"),
  newsSince: isoDate.optional().describe("News from this point in time on (default: `days` days ago)"),
  overdueMaxAgeDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(60)
    .describe("Only list overdue tasks whose deadline is at most this many days ago (and only from current courses)"),
};
type OverviewArgs = { days?: number; newsSince?: string; overdueMaxAgeDays?: number };

export async function overview(ctx: AppContext, args: OverviewArgs) {
  const days = args.days ?? 7;
  const overdueMaxAgeDays = args.overdueMaxAgeDays ?? 60;
  const nowMs = ctx.now().getTime();
  const since = args.newsSince ?? new Date(nowMs - days * 86_400_000).toISOString();

  // Threads first: their participants fill the name dictionary for task/news texts
  const threads = await ctx.it.messageThreads(50).catch(() => {
    log.warn("Messages not available for the overview");
    return undefined;
  });
  const allThreads = threads?.Threads?.EntityArray ?? [];
  for (const t of allThreads) registerThread(ctx.redactor.people, t);
  const unread = allThreads.filter(isUnread);

  const [tasks, news, active] = await Promise.all([
    listTasks(ctx, { status: "open", dueWithinDays: days, limit: 100 }),
    listNews(ctx, { since, limit: 15 }),
    activeCourseIds(ctx).catch(() => undefined),
  ]);

  // Old leftovers (previous school years, inactive courses) are noise for agents
  const oldestOverdue = nowMs - overdueMaxAgeDays * 86_400_000;
  const overdue = tasks.tasks.filter((t) => {
    if (!t.overdue) return false;
    if (active && t.courseId !== undefined && !active.has(t.courseId)) return false;
    return (deadlineMs(t.deadline) ?? 0) >= oldestOverdue;
  });

  return {
    period: { days, newsSince: since, overdueMaxAgeDays },
    overdue,
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
      title: "Overview",
      description:
        "Starting point: recently overdue and upcoming tasks (current courses only), recent news and unread messages at a glance. Use the specific tools for details (get_task, list_news, get_message_thread).",
      inputSchema: overviewInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_overview", async (args: OverviewArgs) => {
      const d = await overview(ctx, args);
      return ok(
        `Overdue: ${d.overdue.length} · due within ${d.period.days} days: ${d.dueSoon.length} · news: ${d.news.length} · unread conversations: ${d.unreadThreads}.`,
        d,
      );
    }),
  );
}
