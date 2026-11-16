/**
 * Zentrale Schwärzungs-Pipeline für alle Freitexte (Spec 6.4):
 * HTML → Text, Geheimnis-URLs entfernen, Kontaktdaten, Namens-Wörterbuch, Längenbegrenzung.
 */
import type { ApiPerson } from "../api/types";
import { NameDictionary, redactContacts } from "./freetext";
import { htmlToText, looksLikeHtml } from "./html";
import { stripSecretUrls } from "./secrets";

export const SELF_DISPLAY = "Ich";

export class Redactor {
  readonly names = new NameDictionary();
  private selfId?: number;

  /** Das eigene Konto wird überall zu "Ich" – der Klarname des Kontoinhabers geht nie raus. */
  registerSelf(p: ApiPerson) {
    this.selfId = p.PersonId;
    this.names.addPerson({ firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName }, SELF_DISPLAY);
  }

  get isSelfRegistered() {
    return this.selfId !== undefined;
  }

  /** Freitext (HTML oder Text) schwärzen. */
  text(input: string | null | undefined, maxLen?: number): string {
    if (!input) return "";
    let s = looksLikeHtml(input) ? htmlToText(input) : input.trim();
    s = stripSecretUrls(s);
    s = redactContacts(s);
    s = this.names.apply(s);
    return truncate(s, maxLen);
  }

  /** Kurze Texte wie Titel/Kursnamen (kein HTML erwartet, aber sicherheitshalber gleich behandelt). */
  title(input: string | null | undefined): string {
    return this.text(input, 300).replace(/\s*\n\s*/g, " ");
  }
}

export function truncate(s: string, maxLen?: number): string {
  if (!maxLen || s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
}
