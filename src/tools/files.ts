import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ApiResource } from "../api/types";
import type { AppContext } from "../context";
import { ToolError } from "../errors";
import { canExtractText, extensionOf, extractText } from "../files/extract";
import { type FileRefDto, formatRef } from "../files/refs";
import { log } from "../log";
import { warmCourse, warmForFileRef } from "./people";
import { handler, ok } from "./result";

const MAX_ITEMS = 300;
const PAGE_TEXT_LEN = 5_000;

// ---------- Hilfen für andere Tools ----------

/** Dateiname schwärzen (Namen im Dateinamen ersetzen), Endung behalten, unsichere Zeichen entfernen. */
export function redactFileName(ctx: AppContext, name: string): string {
  const ext = extensionOf(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const clean = ctx.redactor.title(base).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim() || "Datei";
  return ext ? `${clean}.${ext}` : clean;
}

export function elementFileRef(ctx: AppContext, elementId: number, title: string | null | undefined): FileRefDto {
  return { fileRef: formatRef({ kind: "element", elementId }), name: ctx.redactor.title(title) || `Element ${elementId}`, kind: "unknown" };
}

// ---------- list_course_files ----------

export type CourseItemDto = {
  elementId: number;
  title: string;
  kind: "folder" | "element";
  elementType: string;
  path?: string;
  depth: number;
  parentFolderId?: number;
  homework: boolean;
  active: boolean;
  fileRef?: string;
};

export const listCourseFilesInput = {
  courseId: z.number().int().positive().describe("courseId aus itslearning_list_courses"),
  folderId: z.number().int().positive().optional().describe("elementId eines Ordners (Standard: Hauptordner des Kurses)"),
  recursive: z.boolean().default(false).describe("Unterordner mit auflisten"),
  maxDepth: z.number().int().min(1).max(6).default(3),
};
type ListCourseFilesArgs = { courseId: number; folderId?: number; recursive?: boolean; maxDepth?: number };

const isFolder = (r: ApiResource) => /folder/i.test(r.ElementType ?? "");

export async function listCourseFiles(ctx: AppContext, args: ListCourseFilesArgs) {
  const maxDepth = args.recursive ? (args.maxDepth ?? 3) : 1;
  await warmCourse(ctx, args.courseId);
  const items: CourseItemDto[] = [];
  let truncated = false;
  const queue: { folderId?: number; depth: number }[] = [{ folderId: args.folderId, depth: 0 }];

  while (queue.length) {
    const { folderId, depth } = queue.shift()!;
    const res = folderId === undefined ? await ctx.it.courseResources(args.courseId) : await ctx.it.folderResources(args.courseId, folderId);
    for (const r of res) {
      if (items.length >= MAX_ITEMS) {
        truncated = true;
        break;
      }
      const folder = isFolder(r);
      items.push({
        elementId: r.ElementId,
        title: ctx.redactor.title(r.Title),
        kind: folder ? "folder" : "element",
        elementType: r.ElementType ?? "Unknown",
        ...(r.Path ? { path: ctx.redactor.title(r.Path) } : {}),
        depth,
        ...(folderId !== undefined ? { parentFolderId: folderId } : {}),
        homework: r.Homework ?? false,
        active: r.Active ?? true,
        ...(folder ? {} : { fileRef: formatRef({ kind: "element", elementId: r.ElementId }) }),
      });
      if (folder && depth + 1 < maxDepth) queue.push({ folderId: r.ElementId, depth: depth + 1 });
    }
    if (truncated) break;
  }
  return { courseId: args.courseId, items, total: items.length, truncated };
}

// ---------- download_file ----------

export const downloadFileInput = {
  fileRef: z.string().min(3).max(64).describe("fileRef aus einem anderen Tool (Aufgabe, Nachricht, Ankündigung, Kurs-Dateien)"),
  mode: z
    .enum(["auto", "text", "blob", "both"])
    .default("auto")
    .describe("auto = Text wenn extrahierbar (PDF, DOCX, Text), Bilder als Bild, sonst Datei · text = nur geschwärzter Text · blob = nur Datei · both"),
  maxTextChars: z.number().int().min(500).max(200_000).default(50_000),
};
type DownloadArgs = { fileRef: string; mode?: "auto" | "text" | "blob" | "both"; maxTextChars?: number };

export async function downloadFile(ctx: AppContext, args: DownloadArgs): Promise<CallToolResult> {
  const mode = args.mode ?? "auto";
  const maxText = args.maxTextChars ?? 50_000;
  await warmForFileRef(ctx, args.fileRef); // Namen aller möglichen Personen im Dokument registrieren
  const r = await ctx.files.download(args.fileRef);

  if (r.type === "page") {
    const text = ctx.redactor.text(r.html, PAGE_TEXT_LEN);
    const data = { fileRef: r.ref, kind: "page" as const, title: ctx.redactor.title(r.title), text };
    return ok(`„${data.title}“ ist keine Datei, sondern eine itslearning-Seite (z. B. Link, Notiz oder Test). Seiteninhalt geschwärzt:`, data);
  }

  const name = redactFileName(ctx, r.name);
  const isImage = r.mimeType.startsWith("image/");
  const wantText = mode === "text" || mode === "both" || (mode === "auto" && !isImage);
  let text: string | undefined;
  let textTruncated = false;
  if (wantText && canExtractText(r.mimeType, r.name)) {
    const raw = await extractText(r.data, r.mimeType, r.name);
    if (raw) {
      const full = ctx.redactor.text(raw);
      textTruncated = full.length > maxText;
      text = textTruncated ? `${full.slice(0, maxText)}…` : full;
    }
  }
  if (mode === "text" && text === undefined) {
    throw new ToolError("NOT_A_FILE", `Aus „${name}“ (${r.mimeType}) lässt sich kein Text extrahieren – mode "blob" verwenden.`);
  }
  const includeBlob = mode === "blob" || mode === "both" || (mode === "auto" && (isImage || text === undefined));

  let savedTo: string | undefined;
  if (ctx.cfg.downloadDir) {
    try {
      await mkdir(ctx.cfg.downloadDir, { recursive: true });
      savedTo = join(ctx.cfg.downloadDir, `${r.ref}_${name}`);
      await writeFile(savedTo, r.data);
    } catch (e) {
      savedTo = undefined;
      log.warn("Datei konnte nicht in DOWNLOAD_DIR gespeichert werden", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  const meta = {
    fileRef: r.ref,
    kind: isImage ? ("image" as const) : ("file" as const),
    name,
    mimeType: r.mimeType,
    sizeBytes: r.data.byteLength,
    cached: r.cached,
    textIncluded: text !== undefined,
    ...(text !== undefined ? { textChars: text.length, textTruncated } : {}),
    blobIncluded: includeBlob,
    ...(savedTo ? { savedTo } : {}),
  };

  const content: CallToolResult["content"] = [
    {
      type: "text",
      text:
        `Datei „${name}“ (${meta.mimeType}, ${Math.ceil(meta.sizeBytes / 1024)} KB)${r.cached ? " aus dem Cache" : ""}.` +
        (includeBlob ? " Hinweis: Der Datei-Inhalt selbst ist NICHT geschwärzt." : "") +
        (savedTo ? ` Gespeichert unter ${savedTo}.` : "") +
        `\n\n${JSON.stringify(meta, null, 2)}`,
    },
  ];
  if (text !== undefined) content.push({ type: "text", text: `--- Inhalt (Text, geschwärzt) ---\n${text}` });
  if (includeBlob) {
    const b64 = Buffer.from(r.data).toString("base64");
    content.push(
      isImage
        ? { type: "image", data: b64, mimeType: r.mimeType }
        : { type: "resource", resource: { uri: `itslearning-file:${r.ref}`, mimeType: r.mimeType, blob: b64 } },
    );
  }
  return { content, structuredContent: meta };
}

export function registerFileTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_course_files",
    {
      title: "Kurs-Dateien",
      description:
        "Ordner und Elemente (Dateien, Links, Seiten …) eines Kurses, optional rekursiv. Elemente haben eine fileRef für itslearning_download_file.",
      inputSchema: listCourseFilesInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_course_files", async (args: ListCourseFilesArgs) => {
      const data = await listCourseFiles(ctx, args);
      const folders = data.items.filter((i) => i.kind === "folder").length;
      return ok(`${data.total - folders} Elemente, ${folders} Ordner${data.truncated ? " (gekürzt)" : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_download_file",
    {
      title: "Datei herunterladen",
      description:
        "Lädt eine Datei über ihre fileRef. Standard (mode=auto): PDF/DOCX/Text als geschwärzter Text, Bilder als Bild, andere Formate als Datei. Achtung: Bilder und Dateien (blob) sind inhaltlich NICHT geschwärzt – nur extrahierter Text ist es.",
      inputSchema: downloadFileInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_download_file", (args: DownloadArgs) => downloadFile(ctx, args)),
  );
}
