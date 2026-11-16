/**
 * Datei-Downloads (Spec 5.10, docs/itslearning-api.md → "Dateien herunterladen"):
 *   element      → courses/resources/{id}/v1 → sso/url/v1 → Web-Session → (iframes) → DownloadRedirect → Datei
 *   assignment   → assignments/{id}/files/{fileId}/v1 (302) → Datei
 *   message      → AttachmentUrl (tokenisierte filerepository-URL) → Datei
 *   bulletinImage→ OriginalFileUrl (tokenisiert) → Datei
 * Geheime URLs bleiben in dieser Klasse; nach außen gehen nur Name, Typ und Bytes.
 */
import type { ItslearningApi } from "../context";
import { ToolError } from "../errors";
import { log } from "../log";
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
  /** Element ist keine Datei (z. B. Seite, Link, Test) – HTML der Seite, NICHT geschwärzt. */
  | { type: "page"; ref: string; title: string; html: string };

const MAX_FRAME_DEPTH = 3;
const MAX_REMEMBERED = 2_000;

export class FileService {
  private urls = new Map<string, string>();
  private jar = new CookieJar();

  constructor(
    private api: FileApi,
    private browser: WebBrowser,
    private opts: { maxBytes: number; cache?: FileCache },
  ) {}

  /** Tools merken sich geheime URLs zu Referenzen, die sie gerade ausgegeben haben (spart erneutes Nachschlagen). */
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
        return this.fetchDirect(ref, loc, `Anhang-${src.fileId}`);
      }
      case "message": {
        const url = this.urls.get(ref) ?? (await this.findMessageAttachment(src.threadId, src.messageId));
        return this.fetchDirect(ref, url, "Anhang");
      }
      case "bulletinImage": {
        const url = this.urls.get(ref) ?? (await this.findBulletinImage(src.courseId, src.bulletinId, src.index));
        return this.fetchDirect(ref, url, `Bild-${src.index + 1}`);
      }
    }
  }

  /** Tokenisierte URL direkt laden (ohne Cookies). */
  private async fetchDirect(ref: string, url: string, fallbackName: string): Promise<DownloadResult> {
    const br = await this.browser.get(url);
    if (!br.res.ok) {
      await br.res.body?.cancel().catch(() => {});
      throw br.res.status === 404 || br.res.status === 403
        ? new ToolError("NOT_FOUND", "Datei nicht (mehr) verfügbar – Liste erneut abrufen.", br.res.status)
        : new ToolError("UPSTREAM_ERROR", "Datei-Server von itslearning hat die Anfrage abgelehnt.", br.res.status);
    }
    if (!isFileResponse(br.res)) {
      await br.res.body?.cancel().catch(() => {});
      throw new ToolError("NOT_A_FILE", "Unter dieser Referenz liegt keine Datei.");
    }
    return this.toFile(ref, br, fallbackName);
  }

  private async toFile(ref: string, br: BrowseResult, fallbackName: string): Promise<DownloadResult> {
    const data = await readLimited(br.res, this.opts.maxBytes);
    const name = filenameFromDisposition(br.res.headers.get("content-disposition")) ?? fallbackName;
    return { type: "file", ref, name, mimeType: resolveMimeType(br.res.headers.get("content-type"), name), data, cached: false };
  }

  /** Kurs-Element über die Web-Oberfläche. Bei abgelaufener Web-Session einmal mit frischer Session wiederholen. */
  private async downloadElement(ref: string, elementId: number): Promise<DownloadResult> {
    const detail = await this.api.resource(elementId);
    if (/folder/i.test(detail.ElementType ?? "")) throw new ToolError("NOT_A_FILE", "Das ist ein Ordner – Inhalte mit itslearning_list_course_files abrufen.");
    const target = detail.ContentUrl || detail.Url;
    if (!target) throw new ToolError("NOT_A_FILE", "Für dieses Element gibt es keinen Inhalt.");
    const title = detail.Title?.trim() || `Element-${elementId}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) this.jar = new CookieJar();
      const sso = await this.api.ssoUrl(target);
      const result = await this.follow(ref, await this.browser.get(sso, this.jar), title, 0);
      if (result !== "login") return result;
      log.info("Web-Session abgelaufen – neuer Versuch");
    }
    throw new ToolError("UPSTREAM_ERROR", "Anmeldung an der itslearning-Weboberfläche fehlgeschlagen.");
  }

  /** Folgt Download-Links und iframes, bis eine Datei kommt (oder klar ist, dass es keine gibt). */
  private async follow(ref: string, br: BrowseResult, title: string, depth: number): Promise<DownloadResult | "login"> {
    if (br.res.ok && isFileResponse(br.res)) return this.toFile(ref, br, title);
    if (!br.res.ok) {
      await br.res.body?.cancel().catch(() => {});
      throw br.res.status === 403 || br.res.status === 404
        ? new ToolError("FORBIDDEN", "Kein Zugriff auf diese Datei.", br.res.status)
        : new ToolError("UPSTREAM_ERROR", "itslearning-Weboberfläche nicht erreichbar.", br.res.status);
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
    if (!url) throw new ToolError("FILE_REF_UNKNOWN", "Anhang nicht gefunden – Unterhaltung erneut abrufen.");
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
    throw new ToolError("FILE_REF_UNKNOWN", "Bild nicht gefunden – Ankündigungen erneut abrufen.");
  }
}
