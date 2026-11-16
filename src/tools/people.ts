/**
 * Übernimmt Personen aus API-Antworten in die Registry – IMMER vor dem Schwärzen der Texte
 * derselben Antwort, damit deren Namen im Wörterbuch stehen.
 */
import type { ApiMessage, ApiPublishedBy, ApiThread } from "../api/types";
import type { PersonRegistry, RoleHint } from "../redaction/registry";

export function registerPublishedBy(r: PersonRegistry, p: ApiPublishedBy | null | undefined, hint: RoleHint = "none") {
  if (!p) return;
  r.register(p.PersonId, { firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName }, hint);
}

export function registerMessage(r: PersonRegistry, m: ApiMessage | null | undefined) {
  if (!m) return;
  r.register(m.CreatedBy, { fullName: m.CreatedByName, shortName: m.CreatedByShortName });
}

export function registerThread(r: PersonRegistry, t: ApiThread) {
  for (const p of t.Participants ?? []) r.registerParticipant(p);
  if (t.CreatedByTeacher && t.CreatedBy) r.register(t.CreatedBy, {}, "teacher");
  registerMessage(r, t.LastMessage);
  for (const m of t.Messages?.EntityArray ?? []) registerMessage(r, m);
}
