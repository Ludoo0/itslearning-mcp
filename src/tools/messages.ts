import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiMessage, ApiThread } from "../api/types";
import type { AppContext } from "../context";
import type { Person } from "../redaction/registry";
import { isShareableUrl } from "../redaction/secrets";
import { registerMessage, registerThread } from "./people";
import { handler, ok } from "./result";

const PREVIEW_LEN = 200;
const TEXT_LEN = 8_000;
const MAX_LISTED_PARTICIPANTS = 5;
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
  if (t.Name?.trim()) return ctx.redactor.title(t.Name);
  const location = (t.LocationRecipients ?? []).map((l) => ctx.redactor.title(l.Title)).filter(Boolean);
  if (location.length) return location.join(", ");
  if (!others.length) return "Nachrichten";
  const names = others.slice(0, 3).map((p) => p.display);
  return names.join(", ") + (others.length > 3 ? ` +${others.length - 3}` : "");
}

export function toThreadDto(ctx: AppContext, t: ApiThread): ThreadDto {
  const people = ctx.redactor.people;
  const others = (t.Participants ?? []).filter((p) => p.PersonId !== people.selfPersonId && !p.IsDeleted).map((p) => people.resolve(p.PersonId));
  // Große Gruppen: nur Lehrkräfte namentlich (Pseudonym-Listen von 30 Schüler:innen helfen niemandem)
  const listed = others.length > MAX_LISTED_PARTICIPANTS ? others.filter((p) => p.role === "teacher") : others;
  const lm = t.LastMessage;
  return {
    threadId: t.InstantMessageThreadId,
    title: threadTitle(ctx, t, others),
    type: t.Type ?? "Unknown",
    participants: listed,
    participantsCount: t.ParticipantsCount ?? (t.Participants?.length ?? 0),
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
  type: z.enum(THREAD_TYPES).optional().describe("OneToOne = Einzelchat, Group = Gruppe, Course = Kurs-Nachricht"),
  cursor: z.number().int().optional().describe("nextCursor aus einem vorherigen Aufruf (Folgeseite)"),
};
type ListThreadsArgs = { limit?: number; unreadOnly?: boolean; type?: (typeof THREAD_TYPES)[number]; cursor?: number };

export async function listThreads(ctx: AppContext, args: ListThreadsArgs) {
  const limit = args.limit ?? 20;
  // Bei Filtern eine größere Seite holen, damit nach dem Filtern genug übrig bleibt
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
  return {
    threads: page.map((t) => toThreadDto(ctx, t)),
    total: res.Threads?.Total ?? all.length,
    hasMore,
    ...(res.HasMore && typeof lastSort === "number" ? { nextCursor: lastSort } : {}),
  };
}

// ---------- get_message_thread ----------

export const getThreadInput = {
  threadId: z.number().int().positive().describe("threadId aus itslearning_list_message_threads"),
  limit: z.number().int().min(1).max(100).default(30),
  beforeMessageId: z.number().int().positive().optional().describe("Ältere Nachrichten vor dieser messageId laden"),
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
  attachmentName?: string;
  link?: { url: string; title?: string };
};

function toMessageDto(ctx: AppContext, m: ApiMessage): MessageDto {
  const link = m.Link && isShareableUrl(m.Link) ? { url: m.Link, ...(m.LinkTitle ? { title: ctx.redactor.title(m.LinkTitle) } : {}) } : undefined;
  return {
    messageId: m.MessageId,
    at: m.Created ?? null,
    from: ctx.redactor.people.resolve(m.CreatedBy),
    text: m.IsDeleted ? "" : ctx.redactor.text(m.Text, TEXT_LEN),
    edited: m.IsEdited ?? false,
    deleted: m.IsDeleted ?? false,
    system: m.IsSystemMessage ?? false,
    ...(m.AttachmentName ? { attachmentName: ctx.redactor.title(m.AttachmentName) } : {}), // Download: Meilenstein 3
    ...(link ? { link } : {}),
  };
}

export async function getThread(ctx: AppContext, args: GetThreadArgs) {
  const limit = args.limit ?? 30;
  // Thread-Metadaten (Teilnehmer + Rollen) aus der Thread-Liste; die Liste ist gecacht
  const list = await ctx.it.messageThreads(100);
  const meta = list.Threads?.EntityArray?.find((t) => t.InstantMessageThreadId === args.threadId);
  if (meta) registerThread(ctx.redactor.people, meta);

  const res = await ctx.it.threadMessages(args.threadId, limit, args.beforeMessageId);
  const msgs = res.Messages?.EntityArray ?? [];
  for (const m of msgs) registerMessage(ctx.redactor.people, m);

  const sorted = [...msgs].sort((a, b) => (Date.parse(a.Created ?? "") || 0) - (Date.parse(b.Created ?? "") || 0) || a.MessageId - b.MessageId);
  const total = res.Messages?.Total ?? msgs.length;
  return {
    threadId: args.threadId,
    ...(meta ? { title: toThreadDto(ctx, meta).title, type: meta.Type ?? "Unknown" } : {}),
    messages: sorted.map((m) => toMessageDto(ctx, m)),
    total,
    hasMore: msgs.length < total,
    ...(msgs.length < total && sorted[0] ? { olderBeforeMessageId: sorted[0].MessageId } : {}),
  };
}

export function registerMessageTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_message_threads",
    {
      title: "Nachrichten-Threads",
      description:
        "Listet Nachrichten-Unterhaltungen (neueste zuerst) mit letzter Nachricht und Ungelesen-Status. Personen sind pseudonymisiert (Lehrkräfte als „Frau/Herr Nachname“, das eigene Konto als „Ich“).",
      inputSchema: listThreadsInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_message_threads", async (args: ListThreadsArgs) => {
      const data = await listThreads(ctx, args);
      const unread = data.threads.filter((t) => t.unread).length;
      return ok(`${data.threads.length} Unterhaltungen${unread ? `, ${unread} ungelesen` : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_get_message_thread",
    {
      title: "Unterhaltung lesen",
      description: "Nachrichten einer Unterhaltung in zeitlicher Reihenfolge (älteste zuerst). Texte sind geschwärzt. Ältere Nachrichten über beforeMessageId.",
      inputSchema: getThreadInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_get_message_thread", async (args: GetThreadArgs) => {
      const data = await getThread(ctx, args);
      return ok(`${data.messages.length} Nachrichten${data.hasMore ? " (ältere vorhanden)" : ""}.`, data);
    }),
  );
}
