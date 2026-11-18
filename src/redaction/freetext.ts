/**
 * Free-text redaction (spec 6.4): name dictionary + regexes for contact data.
 * The dictionary is filled from structured API fields (every person the server has seen).
 */
import { LABELS, type Labels } from "./labels";

/**
 * Common words that are also names – never replaced as a single word (avoids false positives).
 * German list because the reference deployment is German; extend per deployment via REDACTION_KEEP_WORDS.
 */
export const STOPWORDS = new Set([
  "mai",
  "rose",
  "klein",
  "groß",
  "gross",
  "wolf",
  "fuchs",
  "weiß",
  "weiss",
  "schwarz",
  "braun",
  "lang",
  "kurz",
  "bach",
  "berg",
  "stein",
  "winter",
  "sommer",
  "frank",
  "ernst",
  "will",
  "kaiser",
  "könig",
  "koenig",
  "vogel",
  "hahn",
  "jung",
  "alt",
  "neu",
  "busch",
  "baum",
  "wald",
  "see",
  "licht",
  "kraft",
  "engel",
  "frei",
  "glück",
  "gut",
  "mann",
  "frau",
  "herr",
  "kind",
  "april",
  "august",
  "juni",
  "juli",
  "lehrer",
  "lehrerin",
  "may",
  "june",
  "grace",
  "hope",
  "joy",
  "mark",
  "bill",
  "rich",
  "young",
  "white",
  "black",
  "brown",
  "green",
  "teacher",
  "student",
]);

/**
 * Salutations used in front of teacher last names (en, de, nb/sv, nl, fr).
 * Only ever combined with a teacher's last name – never matched on their own.
 */
const SALUTATIONS = [
  // English
  "Mr",
  "Mr.",
  "Mrs",
  "Mrs.",
  "Ms",
  "Ms.",
  "Miss",
  "Dr",
  "Dr.",
  // German ("Herr" is also Norwegian/Swedish)
  "Frau",
  "Herr",
  "Herrn",
  "Fr.",
  "Hr.",
  // Norwegian / Swedish
  "Fru",
  "Fröken",
  // Dutch
  "Mevrouw",
  "Mevr.",
  "Mw.",
  "Meneer",
  "Dhr.",
  "Juf",
  "Juffrouw",
  "Meester",
  // French
  "Madame",
  "Mme",
  "Mme.",
  "Mademoiselle",
  "Mlle",
  "Monsieur",
  "M.",
];

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

/** Name particles that are never replaced on their own when a compound last name is split into parts. */
const NAME_PARTICLES = new Set([
  "von",
  "vom",
  "zu",
  "zum",
  "zur",
  "van",
  "der",
  "den",
  "de",
  "del",
  "della",
  "des",
  "di",
  "da",
  "das",
  "dos",
  "du",
  "la",
  "le",
  "ter",
  "ten",
  "af",
  "av",
  "y",
]);

const clean = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Letters that NFD does not decompose. */
const SPECIAL_FOLD: Record<string, string> = {
  ß: "ss",
  ẞ: "ss",
  ø: "o",
  æ: "ae",
  œ: "oe",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ı: "i",
};

/** Folds one character: lowercase, without diacritics ("É" → "e", "ß" → "ss"); combining marks become "". */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  return SPECIAL_FOLD[lower] ?? lower.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Case- and diacritic-insensitive form used for matching names. */
export function foldName(s: string): string {
  let out = "";
  for (const ch of s) out += foldChar(ch);
  return out;
}

/** German transliteration of umlauts ("Müller" → "Mueller"), applied before folding. */
const transliterate = (s: string) => s.replace(/[äöüÄÖÜ]/g, (c) => `${foldChar(c)}e`).replace(/[ßẞ]/g, "ss");

/** Folded text plus, for every folded code unit, the range of the original character it came from. */
function foldWithMap(text: string) {
  let folded = "";
  const origStart: number[] = [];
  const origEnd: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) {
      origStart.push(i);
      origEnd.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  return { folded, origStart, origEnd };
}

export class NameDictionary {
  private map = new Map<string, string>(); // folded pattern → replacement
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
    // Compound names ("Ibáñez Olmedo", "Lindqvist-Ødegård", "Anna-Lena") are often signed with one part only
    const parts = (s: string) => {
      const tokens = s.split(/[\s-]+/);
      if (tokens.length < 2) return [];
      return tokens.filter((x) => x.length >= MIN_SINGLE_NAME_LEN && !NAME_PARTICLES.has(foldName(x)));
    };
    const lastVariants = last ? [last, ...parts(last)] : [];
    const firstVariants = first ? [first, ...parts(first)] : [];
    const multi: string[] = [clean(p.fullName), clean(p.shortName)];
    if (first && last) {
      multi.push(`${last}, ${first}`, `${last} ${first}`);
      for (const l of lastVariants) {
        for (const f of firstVariants) multi.push(`${f} ${l}`);
        multi.push(`${first[0]}. ${l}`);
      }
    }
    // "Mrs/Frau <last name>" only for teachers – otherwise collisions with students of the same name
    if (opts.withTitles) for (const l of lastVariants) for (const s of SALUTATIONS) multi.push(`${s} ${l}`);
    for (const m of multi) if (m.includes(" ") || m.length >= MIN_SINGLE_NAME_LEN) this.addSingleOrMulti(m, display, m.includes(" "));
    for (const single of [...firstVariants, ...lastVariants]) {
      if (single.length >= MIN_SINGLE_NAME_LEN) this.addSingleOrMulti(single, display, false);
    }
  }

  private addSingleOrMulti(pattern: string, replacement: string, multiWord: boolean) {
    const variants = new Set([foldName(pattern), foldName(transliterate(pattern))]);
    for (const key of variants) {
      if (!multiWord && this.isStopword(key)) continue;
      this.add(key, replacement);
    }
  }

  private foldedStopwords?: Set<string>;
  private isStopword(key: string) {
    this.foldedStopwords ??= new Set([...STOPWORDS, ...this.keepWords].map(foldName));
    return this.foldedStopwords.has(key);
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
      "gu",
    );
    // Match on the folded text (case/diacritics/transliteration-insensitive), replace in the original
    const { folded, origStart, origEnd } = foldWithMap(text);
    let out = "";
    let pos = 0;
    for (const m of folded.matchAll(this.regex)) {
      const start = origStart[m.index];
      let end = origEnd[m.index + m[0].length - 1];
      if (start === undefined || end === undefined || start < pos) continue;
      // swallow combining marks that belong to the last matched letter
      while (end < text.length && foldChar(String.fromCodePoint(text.codePointAt(end) ?? 0)) === "") {
        end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
      }
      out += text.slice(pos, start) + (this.map.get(m[0].replace(/\s+/g, " ")) ?? this.ambiguousLabel);
      pos = end;
    }
    return out + text.slice(pos);
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
