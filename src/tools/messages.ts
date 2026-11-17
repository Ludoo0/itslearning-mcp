import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiMessage, ApiThread } from "../api/types";
import type { AppContext } from "../context";
import { type FileRefDto, formatRef } from "../files/refs";
import type { Person } from "../redaction/registry";
import { isShareableUrl } from "../redaction/secrets";
import { redactFileName } from "./files";
import { registerMessage, registerThread } from "./people";
import { handler, ok } from "./result";

const PREVIEW_LEN = 200;
const TEXT_LEN = 8_000;
const MAX_LISTED_PARTICIPANTS = 5;
/** Threads without a name and with more other participants than this get a group title. */
const GROUP_TITLE_THRESHOLD = 3;
const MAX_TEACHERS_IN_TITLE = 3;
const THREAD_TYPES = ["OneToOne", "Group", "Course"] as const;

export type ThreadDto = {
  threadId: number;
  title: string;
  type: string;
  participants: Person[];
  participantsCount: number;
  lastMessage: { at: string | null; from: Person; preview: string } | null;
  unread: boolean;
};

export function isUnread(t: ApiThread): boolean {
  const last = t.LastMessage?.MessageId;
  if (!last) return false;
  return (t.LastReadInstantMessageId ?? 0) < last;
}

function threadTitle(ctx: AppContext, t: ApiThread, others: Person[]): string {
  const L = ctx.redactor.labels;
  if (t.Name?.trim()) return ctx.redactor.title(t.Name);
  const location = (t.LocationRecipients ?? []).map((l) => ctx.redactor.title(l.Title)).filter(Boolean);
  if (location.length) return location.join(", ");
  if (!others.length) return L.messages;
  if (others.length > GROUP_TITLE_THRESHOLD) {
    const teachers = [...new Set(others.filter((p) => p.role === "teacher").map((p) => p.display))].slice(0, MAX_TEACHERS_IN_TITLE);
    return L.group(others.length + 1, teachers);
  }
  return others.map((p) => p.display).join(", ");
}

export function toThreadDto(ctx: AppContext, t: ApiThread): ThreadDto {
  const people = ctx.redactor.people;
  const others = (t.Participants ?? [])
    .filter((p) => p.PersonId !== people.selfPersonId && !p.IsDeleted)
    .map((p) => people.resolve(p.PersonId));
  // Large groups: list teachers only (pseudonym lists of 30 students help nobody)
  const listed = others.length > MAX_LISTED_PARTICIPANTS ? others.filter((p) => p.role === "teacher") : others;
  const lm = t.LastMessage;
  return {
    threadId: t.InstantMessageThreadId,
    title: threadTitle(ctx, t, others),
    type: t.Type ?? "Unknown",
    participants: listed,
    participantsCount: t.ParticipantsCount ?? t.Participants?.length ?? 0,
    lastMessage: lm
      ? { at: lm.Created ?? null, from: people.resolve(lm.CreatedBy), preview: lm.IsDeleted ? "" : ctx.redactor.text(lm.Text, PREVIEW_LEN) }
      : null,
    unread: isUnread(t),
  };
}

// ---------- list_message_threads ----------

export const listThreadsInput = {
  limit: z.number().int().min(1).max(50).default(20),
  unreadOnly: z.boolean().default(false),
  type: z.enum(THREAD_TYPES).optional().describe("OneToOne = direct chat, Group = group, Course = course message"),
  cursor: z.number().int().optional().describe("nextCursor from a previous call (next page)"),
};
type ListThreadsArgs = { limit?: number; unreadOnly?: boolean; type?: (typeof THREAD_TYPES)[number]; cursor?: number };

export async function listThreads(ctx: AppContext, args: ListThreadsArgs) {
  const limit = args.limit ?? 20;
  // With filters, fetch a larger page so enough threads remain after filtering
  const pageSize = args.unreadOnly || args.type ? 100 : limit;
  const res = await ctx.it.messageThreads(pageSize, args.cursor);
  const all = res.Threads?.EntityArray ?? [];
  for (const t of all) registerThread(ctx.redactor.people, t);

  let threads = all;
  if (args.type) threads = threads.filter((t) => t.Type === args.type);
  if (args.unreadOnly) threads = threads.filter(isUnread);
  const page = threads.slice(0, limit);
  const lastSort = all.at(-1)?.SortIndex;
  const hasMore = Boolean(res.HasMore) || threads.length > limit;
  // itslearning reports Total = 0 for threads → only include a real total
  const total = res.Threads?.Total ?? 0;
  return {
    threads: page.map((t) => toThreadDto(ctx, t)),
    ...(total > 0 ? { total } : {}),
    hasMore,
    ...(res.HasMore && typeof lastSort === "number" ? { nextCursor: lastSort } : {}),
  };
}

// ---------- get_message_thread ----------

export const getThreadInput = {
  threadId: z.number().int().positive().describe("threadId from itslearning_list_message_threads"),
  limit: z.number().int().min(1).max(100).default(30),
  beforeMessageId: z.number().int().positive().optional().describe("Load older messages before this messageId"),
};
type GetThreadArgs = { threadId: number; limit?: number; beforeMessageId?: number };

export type MessageDto = {
  messageId: number;
  at: string | null;
  from: Person;
  text: string;
  edited: boolean;
  deleted: boolean;
  system: boolean;
  attachment?: FileRefDto;
  link?: { url: string; title?: string };
};

function toMessageDto(ctx: AppContext, threadId: number, m: ApiMessage): MessageDto {
  const link =
    m.Link && isShareableUrl(m.Link) ? { url: m.Link, ...(m.LinkTitle ? { title: ctx.redactor.title(m.LinkTitle) } : {}) } : undefined;
  let attachment: FileRefDto | undefined;
  if (m.AttachmentUrl && !m.IsDeleted) {
    const fileRef = formatRef({ kind: "message", threadId, messageId: m.MessageId });
    ctx.files.remember(fileRef, m.AttachmentUrl);
    const name = m.AttachmentName ? redactFileName(ctx, m.AttachmentName) : ctx.redactor.labels.attachment;
    attachment = { fileRef, name, kind: /\.(png|jpe?g|gif|webp|heic)$/i.test(name) ? "image" : "file" };
  }
  return {
    messageId: m.MessageId,
    at: m.Created ?? null,
    from: ctx.redactor.people.resolve(m.CreatedBy),
    text: m.IsDeleted ? "" : ctx.redactor.text(m.Text, TEXT_LEN),
    edited: m.IsEdited ?? false,
    deleted: m.IsDeleted ?? false,
    system: m.IsSystemMessage ?? false,
    ...(attachment ? { attachment } : {}),
    ...(link ? { link } : {}),
  };
}

export async function getThread(ctx: AppContext, args: GetThreadArgs) {
  const limit = args.limit ?? 30;
  // Thread metadata (participants + roles) from the thread list; the list is cached
  const list = await ctx.it.messageThreads(100);
  const meta = list.Threads?.EntityArray?.find((t) => t.InstantMessageThreadId === args.threadId);
  if (meta) registerThread(ctx.redactor.people, meta);

  const res = await ctx.it.threadMessages(args.threadId, limit, args.beforeMessageId);
  const msgs = res.Messages?.EntityArray ?? [];
  for (const m of msgs) registerMessage(ctx.redactor.people, m);

  const sorted = [...msgs].sort(
    (a, b) => (Date.parse(a.Created ?? "") || 0) - (Date.parse(b.Created ?? "") || 0) || a.MessageId - b.MessageId,
  );
  // itslearning reports Total = 0 here → a full page means there may be older messages
  const total = res.Messages?.Total ?? 0;
  const hasMore = msgs.length >= limit;
  return {
    threadId: args.threadId,
    ...(meta ? { title: toThreadDto(ctx, meta).title, type: meta.Type ?? "Unknown" } : {}),
    messages: sorted.map((m) => toMessageDto(ctx, args.threadId, m)),
    ...(total > 0 ? { total } : {}),
    hasMore,
    ...(hasMore && sorted[0] ? { olderBeforeMessageId: sorted[0].MessageId } : {}),
  };
}

export function registerMessageTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_message_threads",
    {
      title: "Message threads",
      description:
        "Lists message conversations (newest first) with the last message and unread status. People are pseudonymized (teachers by last name, the account owner as 'Me' or the configured label).",
      inputSchema: listThreadsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_message_threads", async (args: ListThreadsArgs) => {
      const data = await listThreads(ctx, args);
      const unread = data.threads.filter((t) => t.unread).length;
      return ok(`${data.threads.length} conversations${unread ? `, ${unread} unread` : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_get_message_thread",
    {
      title: "Read conversation",
      description:
        "Messages of a conversation in chronological order (oldest first). Texts are redacted. Load older messages via beforeMessageId.",
      inputSchema: getThreadInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_get_message_thread", async (args: GetThreadArgs) => {
      const data = await getThread(ctx, args);
      return ok(`${data.messages.length} messages${data.hasMore ? " (older ones available)" : ""}.`, data);
    }),
  );
}
