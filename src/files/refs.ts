/**
 * Datei-Referenzen (Spec 5.10). Agenten sehen nur diese Referenzen, nie Download-URLs.
 * Die Referenz enthält ausschließlich itslearning-IDs (keine Geheimnisse) und lässt sich
 * zustandslos auflösen – auch nach einem Neustart.
 *
 *   e_<elementId>                     Kurs-Element (Datei-Ressource)      → SSO + Web-Session
 *   a_<elementId>_<fileId>            Anhang einer Aufgabe                → assignments/{id}/files/{fileId}/v1
 *   m_<threadId>_<messageId>          Anhang einer Nachricht              → AttachmentUrl (Token)
 *   i_<courseId>_<bulletinId>_<n>     Bild eines Bulletins                → OriginalFileUrl (Token)
 */
import { ToolError } from "../errors";

export type FileSource =
  | { kind: "element"; elementId: number }
  | { kind: "assignment"; elementId: number; fileId: number }
  | { kind: "message"; threadId: number; messageId: number }
  | { kind: "bulletinImage"; courseId: number; bulletinId: number; index: number };

export function formatRef(s: FileSource): string {
  switch (s.kind) {
    case "element":
      return `e_${s.elementId}`;
    case "assignment":
      return `a_${s.elementId}_${s.fileId}`;
    case "message":
      return `m_${s.threadId}_${s.messageId}`;
    case "bulletinImage":
      return `i_${s.courseId}_${s.bulletinId}_${s.index}`;
  }
}

export function parseRef(ref: string): FileSource {
  const m = ref.trim().match(/^([eami])_(\d+)(?:_(\d+))?(?:_(\d+))?$/);
  if (m) {
    const [, k, a, b, c] = m;
    const n = (x?: string) => Number(x);
    if (k === "e" && !b) return { kind: "element", elementId: n(a) };
    if (k === "a" && b && !c) return { kind: "assignment", elementId: n(a), fileId: n(b) };
    if (k === "m" && b && !c) return { kind: "message", threadId: n(a), messageId: n(b) };
    if (k === "i" && b && c) return { kind: "bulletinImage", courseId: n(a), bulletinId: n(b), index: n(c) };
  }
  throw new ToolError("FILE_REF_UNKNOWN", "Datei-Referenz unbekannt – bitte die Liste (Aufgabe, Nachricht, Kurs-Dateien) erneut abrufen.");
}

export type FileRefDto = { fileRef: string; name: string; kind: "file" | "image" | "unknown" };
