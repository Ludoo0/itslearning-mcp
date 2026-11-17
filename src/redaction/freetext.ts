/**
 * Free-text redaction (spec 6.4): name dictionary + regexes for contact data.
 * The dictionary is filled from structured API fields (every person the server has seen).
 */
import { LABELS, type Labels } from "./labels";

/**
 * Common words that are also names – never replaced as a single word (avoids false positives).
 * German list because the reference deployment is German; extend per deployment via REDACTION_KEEP_WORDS.
 */
export const STOPWORDS = new Set(
  [
    "mai", "rose", "klein", "groß", "gross", "wolf", "fuchs", "weiß", "weiss", "schwarz", "braun", "lang", "kurz",
    "bach", "berg", "stein", "winter", "sommer", "frank", "ernst", "will", "kaiser", "könig", "koenig", "vogel",
    "hahn", "jung", "alt", "neu", "busch", "baum", "wald", "see", "licht", "kraft", "engel", "frei", "glück",
    "gut", "mann", "frau", "herr", "kind", "april", "august", "juni", "juli", "lehrer", "lehrerin",
    "may", "june", "grace", "hope", "joy", "mark", "bill", "rich", "young", "white", "black", "brown", "green",
    "teacher", "student",
  ],
);

/** Salutations used in front of teacher last names (German and English). */
const SALUTATIONS = ["Frau", "Herr", "Herrn", "Fr.", "Hr.", "Mr", "Mr.", "Mrs", "Mrs.", "Ms", "Ms.", "Miss", "Dr", "Dr."];

const MIN_SINGLE_NAME_LEN = 3;

export type PersonNames = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  shortName?: string | null;
};

export type NameDictionaryOptions = {
  /** Replacement for spellings shared by several people. */
  ambiguous?: string;
  /** Words never replaced as a single name (in addition to STOPWORDS), lowercase. */
  keepWords?: ReadonlySet<string>;
};

const clean = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class NameDictionary {
  private map = new Map<string, string>(); // lowercased pattern → replacement
  private ambiguousKeys = new Set<string>();
  private regex?: RegExp;
  private ambiguousLabel: string;
  private keepWords: ReadonlySet<string>;

  constructor(opts: NameDictionaryOptions = {}) {
    this.ambiguousLabel = opts.ambiguous ?? LABELS.en.ambiguousName;
    this.keepWords = opts.keepWords ?? new Set();
  }

  get size() {
    return this.map.size;
  }

  /** Registers all spellings of a person. `display` is the replacement (e.g. "Mrs Miller", "Me"). */
  addPerson(p: PersonNames, display: string, opts: { withTitles?: boolean } = {}) {
    const first = clean(p.firstName);
    const last = clean(p.lastName);
    const multi: string[] = [clean(p.fullName), clean(p.shortName)];
    if (first && last) multi.push(`${first} ${last}`, `${last}, ${first}`, `${last} ${first}`, `${first[0]}. ${last}`);
    // "Mrs/Frau <last name>" only for teachers – otherwise collisions with students of the same name
    if (last && opts.withTitles) for (const s of SALUTATIONS) multi.push(`${s} ${last}`);
    for (const m of multi) if (m.includes(" ") || m.length >= MIN_SINGLE_NAME_LEN) this.addSingleOrMulti(m, display, m.includes(" "));
    for (const single of [first, last]) {
      if (single.length >= MIN_SINGLE_NAME_LEN) this.addSingleOrMulti(single, display, false);
    }
  }

  private addSingleOrMulti(pattern: string, replacement: string, multiWord: boolean) {
    const key = pattern.toLowerCase();
    if (!multiWord && (STOPWORDS.has(key) || this.keepWords.has(key))) return;
    this.add(key, replacement);
  }

  private add(key: string, replacement: string) {
    if (!key) return;
    const existing = this.map.get(key);
    if (existing !== undefined && existing !== replacement) {
      // Same spelling, different people → neutral replacement
      this.ambiguousKeys.add(key);
      this.map.set(key, this.ambiguousLabel);
    } else if (!this.ambiguousKeys.has(key)) {
      this.map.set(key, replacement);
    }
    this.regex = undefined;
  }

  apply(text: string): string {
    if (!text || this.map.size === 0) return text;
    this.regex ??= new RegExp(
      `(?<![\\p{L}\\p{N}])(${[...this.map.keys()]
        .sort((a, b) => b.length - a.length)
        .map((k) => escapeRe(k).replace(/ /g, "\\s+"))
        .join("|")})(?![\\p{L}\\p{N}])`,
      "giu",
    );
    return text.replace(this.regex, (m) => this.map.get(m.toLowerCase().replace(/\s+/g, " ")) ?? this.ambiguousLabel);
  }
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
// Phone: starts with + or 0, at least 7 digits, separators allowed
const PHONE_RE = /(?<![\p{L}\p{N}])(?:\+|0)[\d][\d \t/().-]{5,}\d(?![\p{L}\p{N}])/gu;
const DATE_LIKE_RE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;

export function redactContacts(text: string, labels: Labels = LABELS.en): string {
  return text.replace(EMAIL_RE, labels.email).replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    if (digits < 7 || DATE_LIKE_RE.test(m.trim())) return m;
    return labels.phone;
  });
}

/** Parses REDACTION_KEEP_WORDS (comma-separated) into a lowercase set. */
export function parseKeepWords(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean),
  );
}
