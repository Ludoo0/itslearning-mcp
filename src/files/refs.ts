/**
 * File references (spec 5.10). Agents only ever see these references, never download URLs.
 * A reference contains itslearning ids only (no secrets) and can be resolved
 * statelessly – even after a restart.
 *
 *   e_<elementId>                     course element (file resource)      → SSO + web session
 *   a_<elementId>_<fileId>            task attachment                     → assignments/{id}/files/{fileId}/v1
 *   m_<threadId>_<messageId>          message attachment                  → AttachmentUrl (token)
 *   i_<courseId>_<bulletinId>_<n>     bulletin image                      → OriginalFileUrl (token)
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
  throw new ToolError("FILE_REF_UNKNOWN", "Unknown file reference – please fetch the list again (task, message, course files).");
}

export type FileRefDto = { fileRef: string; name: string; kind: "file" | "image" | "unknown" };
