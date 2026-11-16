/**
 * Zentrale Schwärzungs-Pipeline für alle Freitexte (Spec 6.4):
 * HTML → Text, Geheimnis-URLs entfernen, Kontaktdaten, Namens-Wörterbuch, Längenbegrenzung.
 * Das Wörterbuch wird aus der Personen-Registry gebaut und bei Änderungen neu erzeugt.
 */
import type { ApiPerson } from "../api/types";
import { NameDictionary, redactContacts } from "./freetext";
import { htmlToText, looksLikeHtml } from "./html";
import { PersonRegistry } from "./registry";
import { stripSecretUrls } from "./secrets";
import { TeacherDirectory } from "./teachers";

export const SELF_DISPLAY = "Ich";

export class Redactor {
  private dict = new NameDictionary();
  private dictVersion = -1;

  constructor(
    readonly people: PersonRegistry = new PersonRegistry({
      secret: "test-secret-not-for-production",
      baseUrl: "https://example.itslearning.com",
      teachers: new TeacherDirectory(null),
      redactTeachers: false,
      teacherRoleTitles: ["Lehrer", "Lehrerin", "Lehrkraft", "Teacher"],
    }),
  ) {}

  /** Das eigene Konto wird überall zu "Ich" – der Klarname des Kontoinhabers geht nie raus. */
  registerSelf(p: ApiPerson) {
    this.people.setSelf(p.PersonId, { firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName });
  }

  get isSelfRegistered() {
    return this.people.selfPersonId !== undefined;
  }

  get names(): NameDictionary {
    if (this.dictVersion !== this.people.version) {
      const d = new NameDictionary();
      const entries = this.people.dictionaryEntries();
      // Eigenes Konto zuletzt hinzufügen ist egal – Mehrdeutigkeiten werden ohnehin zu "[Name]"
      for (const e of entries) d.addPerson(e.names, e.display, { withTitles: e.withTitles });
      this.dict = d;
      this.dictVersion = this.people.version;
    }
    return this.dict;
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
