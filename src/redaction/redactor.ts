/**
 * Central redaction pipeline for all free text (spec 6.4):
 * HTML → text, remove secret URLs, contact data, name dictionary, length limit.
 * The dictionary is built from the person registry and rebuilt whenever it changes.
 */
import type { ApiPerson } from "../api/types";
import { NameDictionary, redactContacts } from "./freetext";
import { htmlToText, looksLikeHtml } from "./html";
import type { Labels } from "./labels";
import { PersonRegistry } from "./registry";
import { stripSecretUrls } from "./secrets";
import { TeacherDirectory } from "./teachers";

export type RedactorOptions = {
  /** Words never replaced as a single name (REDACTION_KEEP_WORDS), lowercase. */
  keepWords?: ReadonlySet<string>;
};

export class Redactor {
  private dict: NameDictionary;
  private dictVersion = -1;
  private keepWords: ReadonlySet<string>;

  constructor(
    readonly people: PersonRegistry = new PersonRegistry({
      secret: "test-secret-not-for-production",
      baseUrl: "https://example.itslearning.com",
      teachers: new TeacherDirectory(null),
      redactTeachers: false,
      teacherRoleTitles: ["Teacher", "Staff", "Lehrer", "Lehrerin", "Lehrkraft"],
    }),
    opts: RedactorOptions = {},
  ) {
    this.keepWords = opts.keepWords ?? new Set();
    this.dict = this.newDictionary();
  }

  get labels(): Labels {
    return this.people.labels;
  }

  /** The account owner becomes "Me" everywhere – the owner's real name never leaves the server. */
  registerSelf(p: ApiPerson) {
    this.people.setSelf(p.PersonId, { firstName: p.FirstName, lastName: p.LastName, fullName: p.FullName });
  }

  get isSelfRegistered() {
    return this.people.selfPersonId !== undefined;
  }

  private newDictionary() {
    return new NameDictionary({ ambiguous: this.labels.ambiguousName, keepWords: this.keepWords });
  }

  get names(): NameDictionary {
    if (this.dictVersion !== this.people.version) {
      const d = this.newDictionary();
      for (const e of this.people.dictionaryEntries()) d.addPerson(e.names, e.display, { withTitles: e.withTitles });
      this.dict = d;
      this.dictVersion = this.people.version;
    }
    return this.dict;
  }

  /** Redacts free text (HTML or plain text). */
  text(input: string | null | undefined, maxLen?: number): string {
    if (!input) return "";
    let s = looksLikeHtml(input) ? htmlToText(input, this.labels) : input.trim();
    s = stripSecretUrls(s, this.labels);
    s = redactContacts(s, this.labels);
    s = this.names.apply(s);
    return truncate(s, maxLen);
  }

  /** Short texts like titles/course names (no HTML expected, but treated the same for safety). */
  title(input: string | null | undefined): string {
    return this.text(input, 300).replace(/\s*\n\s*/g, " ");
  }
}

export function truncate(s: string, maxLen?: number): string {
  if (!maxLen || s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}
