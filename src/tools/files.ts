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

// ---------- Helpers for other tools ----------

/** Redacts a file name (names inside are replaced), keeps the extension, removes unsafe characters. */
export function redactFileName(ctx: AppContext, name: string): string {
  const ext = extensionOf(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const clean =
    ctx.redactor
      .title(base)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what must not end up in a file name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
      .trim() || ctx.redactor.labels.file;
  return ext ? `${clean}.${ext}` : clean;
}

export function elementFileRef(ctx: AppContext, elementId: number, title: string | null | undefined): FileRefDto {
  return {
    fileRef: formatRef({ kind: "element", elementId }),
    name: ctx.redactor.title(title) || ctx.redactor.labels.element(elementId),
    kind: "unknown",
  };
}

// ---------- list_course_files ----------

export type CourseItemDto = {
  elementId: number;
  title: string;
  /** file = verified file element; other = link, page, test, … (not distinguished yet) */
  kind: "folder" | "file" | "activity" | "other";
  elementType: string;
  /** itslearning extension id of a LearningToolElement (helps to tell element types apart) */
  learningToolId?: number;
  path?: string;
  depth: number;
  parentFolderId?: number;
  homework: boolean;
  active: boolean;
  fileRef?: string;
};

export const listCourseFilesInput = {
  courseId: z.number().int().positive().describe("courseId from itslearning_list_courses"),
  folderId: z.number().int().positive().optional().describe("elementId of a folder (default: the course's root folder)"),
  recursive: z.boolean().default(false).describe("Include subfolders"),
  maxDepth: z.number().int().min(1).max(6).default(3),
};
type ListCourseFilesArgs = { courseId: number; folderId?: number; recursive?: boolean; maxDepth?: number };

const isFolder = (r: ApiResource) => /folder/i.test(r.ElementType ?? "");

/**
 * LearningToolIds verified as files against a real instance (scripts/dev/element-types.ts: ~92 % of
 * course elements, titles almost all .pdf/.jpg/.png/.mp4). Other ids (links, pages, tests, …) are not
 * mapped yet and reported as "other" – see docs/roadmap.md.
 */
const FILE_TOOL_IDS = new Set([5009]);

export function elementKind(r: ApiResource): CourseItemDto["kind"] {
  if (isFolder(r)) return "folder";
  if (/CustomActivity/i.test(r.ElementType ?? "")) return "activity";
  if (typeof r.LearningToolId === "number" && FILE_TOOL_IDS.has(r.LearningToolId)) return "file";
  return "other";
}

export async function listCourseFiles(ctx: AppContext, args: ListCourseFilesArgs) {
  const maxDepth = args.recursive ? (args.maxDepth ?? 3) : 1;
  await warmCourse(ctx, args.courseId);
  const items: CourseItemDto[] = [];
  let truncated = false;
  const queue: { folderId?: number; depth: number }[] = [{ folderId: args.folderId, depth: 0 }];

  while (queue.length) {
    const { folderId, depth } = queue.shift()!;
    const res =
      folderId === undefined ? await ctx.it.courseResources(args.courseId) : await ctx.it.folderResources(args.courseId, folderId);
    for (const r of res) {
      if (items.length >= MAX_ITEMS) {
        truncated = true;
        break;
      }
      const folder = isFolder(r);
      items.push({
        elementId: r.ElementId,
        title: ctx.redactor.title(r.Title),
        kind: elementKind(r),
        elementType: r.ElementType ?? "Unknown",
        ...(!folder && typeof r.LearningToolId === "number" && r.LearningToolId > 0 ? { learningToolId: r.LearningToolId } : {}),
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
  fileRef: z.string().min(3).max(64).describe("fileRef from another tool (task, message, bulletin, course files)"),
  mode: z
    .enum(["auto", "text", "blob", "both"])
    .default("auto")
    .describe(
      "auto = text if extractable (PDF, DOCX, text), images as image, otherwise the file · text = redacted text only · blob = file only · both",
    ),
  maxTextChars: z.number().int().min(500).max(200_000).default(50_000),
};
type DownloadArgs = { fileRef: string; mode?: "auto" | "text" | "blob" | "both"; maxTextChars?: number };

export async function downloadFile(ctx: AppContext, args: DownloadArgs): Promise<CallToolResult> {
  const mode = args.mode ?? "auto";
  const maxText = args.maxTextChars ?? 50_000;
  await warmForFileRef(ctx, args.fileRef); // register everyone who might appear in the document
  const r = await ctx.files.download(args.fileRef);

  if (r.type === "page") {
    const text = ctx.redactor.text(r.html, PAGE_TEXT_LEN);
    const data = { fileRef: r.ref, kind: "page" as const, title: ctx.redactor.title(r.title), text };
    return ok(`"${data.title}" is not a file but an itslearning page (e.g. link, note or test). Redacted page content:`, data);
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
    throw new ToolError("NOT_A_FILE", `No text can be extracted from "${name}" (${r.mimeType}) – use mode "blob".`);
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
      log.warn("Could not store file in DOWNLOAD_DIR", { error: e instanceof Error ? e.message : String(e) });
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
  // Clients like Claude Code only show structuredContent when present → the text must be part of it.
  const structured = { ...meta, ...(text !== undefined ? { text } : {}) };

  const content: CallToolResult["content"] = [
    {
      type: "text",
      text:
        `File "${name}" (${meta.mimeType}, ${Math.ceil(meta.sizeBytes / 1024)} KB)${r.cached ? " from cache" : ""}.` +
        (includeBlob ? " Note: the file content itself is NOT redacted." : "") +
        (savedTo ? ` Saved to ${savedTo}.` : "") +
        `\n\n${JSON.stringify(meta, null, 2)}`,
    },
  ];
  if (text !== undefined) content.push({ type: "text", text: `--- Content (text, redacted) ---\n${text}` });
  if (includeBlob) {
    const b64 = Buffer.from(r.data).toString("base64");
    content.push(
      isImage
        ? { type: "image", data: b64, mimeType: r.mimeType }
        : { type: "resource", resource: { uri: `itslearning-file:${r.ref}`, mimeType: r.mimeType, blob: b64 } },
    );
  }
  return { content, structuredContent: structured };
}

export function registerFileTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_course_files",
    {
      title: "Course files",
      description:
        'Folders and elements of a course, optionally recursive. `kind` is "file" for file elements, "activity", "folder", or "other" (links, pages, tests … – not distinguished yet; itslearning_download_file tells, returning kind "page" for non-files). Elements have a fileRef for itslearning_download_file.',
      inputSchema: listCourseFilesInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_course_files", async (args: ListCourseFilesArgs) => {
      const data = await listCourseFiles(ctx, args);
      const folders = data.items.filter((i) => i.kind === "folder").length;
      return ok(`${data.total - folders} elements, ${folders} folders${data.truncated ? " (truncated)" : ""}.`, data);
    }),
  );

  server.registerTool(
    "itslearning_download_file",
    {
      title: "Download file",
      description:
        "Downloads a file by its fileRef. Default (mode=auto): PDF/DOCX/text as redacted text (field `text`), images as image, other formats as file. Caution: images and files (blob) are NOT redacted – only extracted text is.",
      inputSchema: downloadFileInput,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_download_file", (args: DownloadArgs) => downloadFile(ctx, args)),
  );
}
