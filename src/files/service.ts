/**
 * File downloads (spec 5.10, docs/itslearning-api.md → "Downloading files"):
 *   element      → courses/resources/{id}/v1 → sso/url/v1 → web session → (iframes) → DownloadRedirect → file
 *   assignment   → assignments/{id}/files/{fileId}/v1 (302) → file
 *   message      → AttachmentUrl (tokenized filerepository URL) → file
 *   bulletinImage→ OriginalFileUrl (tokenized) → file
 * Secret URLs stay inside this class; only name, type and bytes leave it.
 */
import type { ItslearningApi } from "../context";
import { ToolError } from "../errors";
import { log } from "../log";
import { LABELS, type Labels } from "../redaction/labels";
import {
  type BrowseResult,
  CookieJar,
  type WebBrowser,
  extractLinks,
  filenameFromDisposition,
  isFileResponse,
  looksLikeLoginPage,
  readLimited,
} from "../websession/browser";
import type { FileCache } from "./cache";
import { resolveMimeType } from "./extract";
import { type FileSource, parseRef } from "./refs";

export type FileApi = Pick<ItslearningApi, "resource" | "ssoUrl" | "assignmentFileLocation" | "threadMessages" | "courseBulletins">;

export type DownloadResult =
  | { type: "file"; ref: string; name: string; mimeType: string; data: Uint8Array; cached: boolean }
  /** Element is not a file (e.g. page, link, test) – HTML of the page, NOT redacted. */
  | { type: "page"; ref: string; title: string; html: string };

const MAX_FRAME_DEPTH = 3;
const MAX_REMEMBERED = 2_000;

export class FileService {
  private urls = new Map<string, string>();
  private jar = new CookieJar();
  private labels: Labels;

  constructor(
    private api: FileApi,
    private browser: WebBrowser,
    private opts: { maxBytes: number; cache?: FileCache; labels?: Labels },
  ) {
    this.labels = opts.labels ?? LABELS.en;
  }

  /** Tools remember secret URLs for references they just returned (saves another lookup). */
  remember(ref: string, url: string | null | undefined) {
    if (!url) return;
    if (this.urls.size >= MAX_REMEMBERED) this.urls.delete(this.urls.keys().next().value!);
    this.urls.set(ref, url);
  }

  async download(ref: string): Promise<DownloadResult> {
    const src = parseRef(ref);
    const hit = this.opts.cache?.get(ref);
    if (hit) return { type: "file", ref, name: hit.meta.name, mimeType: hit.meta.mimeType, data: hit.data, cached: true };

    const result = await this.fetchSource(ref, src);
    if (result.type === "file") this.opts.cache?.put(ref, { name: result.name, mimeType: result.mimeType, size: result.data.byteLength }, result.data);
    return result;
  }

  private async fetchSource(ref: string, src: FileSource): Promise<DownloadResult> {
    switch (src.kind) {
      case "element":
        return this.downloadElement(ref, src.elementId);
      case "assignment": {
        const loc = await this.api.assignmentFileLocation(src.elementId, src.fileId);
        return this.fetchDirect(ref, loc, `${this.labels.attachment}-${src.fileId}`);
      }
      case "message": {
        const url = this.urls.get(ref) ?? (await this.findMessageAttachment(src.threadId, src.messageId));
        return this.fetchDirect(ref, url, this.labels.attachment);
      }
      case "bulletinImage": {
        const url = this.urls.get(ref) ?? (await this.findBulletinImage(src.courseId, src.bulletinId, src.index));
        return this.fetchDirect(ref, url, this.labels.imageN(src.index + 1));
      }
    }
  }

  /** Tokenisierte URL direkt laden (ohne Cookies). */
  private async fetchDirect(ref: string, url: string, fallbackName: string): Promise<DownloadResult> {
    const br = await this.browser.get(url);
    if (!br.res.ok) {
      await br.res.body?.cancel().catch(() => {});
      throw br.res.status === 404 || br.res.status === 403
        ? new ToolError("NOT_FOUND", "File not available (anymore) – fetch the list again.", br.res.status)
        : new ToolError("UPSTREAM_ERROR", "The itslearning file server rejected the request.", br.res.status);
    }
    if (!isFileResponse(br.res)) {
      await br.res.body?.cancel().catch(() => {});
      throw new ToolError("NOT_A_FILE", "There is no file behind this reference.");
    }
    return this.toFile(ref, br, fallbackName);
  }

  private async toFile(ref: string, br: BrowseResult, fallbackName: string): Promise<DownloadResult> {
    const data = await readLimited(br.res, this.opts.maxBytes);
    const name = filenameFromDisposition(br.res.headers.get("content-disposition")) ?? fallbackName;
    return { type: "file", ref, name, mimeType: resolveMimeType(br.res.headers.get("content-type"), name), data, cached: false };
  }

  /** Course element via the web interface. If the web session expired, retry once with a fresh session. */
  private async downloadElement(ref: string, elementId: number): Promise<DownloadResult> {
    const detail = await this.api.resource(elementId);
    if (/folder/i.test(detail.ElementType ?? "")) throw new ToolError("NOT_A_FILE", "This is a folder – list its content with itslearning_list_course_files.");
    const target = detail.ContentUrl || detail.Url;
    if (!target) throw new ToolError("NOT_A_FILE", "This element has no content.");
    const title = detail.Title?.trim() || `Element-${elementId}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) this.jar = new CookieJar();
      const sso = await this.api.ssoUrl(target);
      const result = await this.follow(ref, await this.browser.get(sso, this.jar), title, 0);
      if (result !== "login") return result;
      log.info("Web session expired – retrying");
    }
    throw new ToolError("UPSTREAM_ERROR", "Login to the itslearning web interface failed.");
  }

  /** Follows download links and iframes until a file arrives (or it is clear there is none). */
  private async follow(ref: string, br: BrowseResult, title: string, depth: number): Promise<DownloadResult | "login"> {
    if (br.res.ok && isFileResponse(br.res)) return this.toFile(ref, br, title);
    if (!br.res.ok) {
      await br.res.body?.cancel().catch(() => {});
      throw br.res.status === 403 || br.res.status === 404
        ? new ToolError("FORBIDDEN", "No access to this file.", br.res.status)
        : new ToolError("UPSTREAM_ERROR", "itslearning web interface not reachable.", br.res.status);
    }
    const html = await br.res.text();
    if (looksLikeLoginPage(html)) return "login";
    const links = extractLinks(html, br.finalUrl);

    for (const dl of links.downloads.slice(0, 2)) {
      const next = await this.browser.get(dl, this.jar);
      if (next.res.ok && isFileResponse(next.res)) return this.toFile(ref, next, title);
      await next.res.body?.cancel().catch(() => {});
    }
    if (links.iframes[0] && depth < MAX_FRAME_DEPTH) {
      return this.follow(ref, await this.browser.get(links.iframes[0], this.jar), title, depth + 1);
    }
    return { type: "page", ref, title, html };
  }

  private async findMessageAttachment(threadId: number, messageId: number): Promise<string> {
    const res = await this.api.threadMessages(threadId, 100);
    const url = res.Messages?.EntityArray?.find((m) => m.MessageId === messageId)?.AttachmentUrl;
    if (!url) throw new ToolError("FILE_REF_UNKNOWN", "Attachment not found – fetch the conversation again.");
    return url;
  }

  private async findBulletinImage(courseId: number, bulletinId: number, index: number): Promise<string> {
    for (let page = 0; page < 5; page++) {
      const res = await this.api.courseBulletins(courseId, page, 50);
      const b = res.EntityArray?.find((x) => x.LightBulletinId === bulletinId);
      if (b) {
        const url = b.AttachedImages?.[index]?.OriginalFileUrl;
        if (!url) break;
        return url;
      }
      if ((res.EntityArray?.length ?? 0) < 50) break;
    }
    throw new ToolError("FILE_REF_UNKNOWN", "Image not found – fetch the announcements again.");
  }
}
