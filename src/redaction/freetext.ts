/**
 * Freitext-Schwärzung (Spec 6.4): Namens-Wörterbuch + Regex für Kontaktdaten.
 * Das Wörterbuch wird aus Strukturfeldern der API befüllt (M1: nur eigenes Konto; M2: alle Personen).
 */

/** Häufige deutsche Wörter, die auch Namen sind – als Einzelwort nicht ersetzen (Fehlalarme vermeiden). */
const STOPWORDS = new Set(
  [
    "mai", "rose", "klein", "groß", "gross", "wolf", "fuchs", "weiß", "weiss", "schwarz", "braun", "lang", "kurz",
    "bach", "berg", "stein", "winter", "sommer", "frank", "ernst", "will", "kaiser", "könig", "koenig", "vogel",
    "hahn", "jung", "alt", "neu", "busch", "baum", "wald", "see", "licht", "kraft", "engel", "frei", "glück",
    "gut", "mann", "frau", "herr", "kind", "april", "august", "juni", "juli", "lehrer", "lehrerin",
  ],
);

const MIN_SINGLE_NAME_LEN = 3;

export type PersonNames = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  shortName?: string | null;
};

const clean = (s?: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class NameDictionary {
  private map = new Map<string, string>(); // lowercased Muster → Ersatz
  private ambiguous = new Set<string>();
  private regex?: RegExp;

  get size() {
    return this.map.size;
  }

  /** Registriert alle Schreibweisen einer Person. `display` ist der Ersatztext (z. B. "Frau Müller", "Ich"). */
  addPerson(p: PersonNames, display: string) {
    const first = clean(p.firstName);
    const last = clean(p.lastName);
    const multi: string[] = [clean(p.fullName), clean(p.shortName)];
    if (first && last) multi.push(`${first} ${last}`, `${last}, ${first}`, `${last} ${first}`, `${first[0]}. ${last}`);
    if (last) multi.push(`Frau ${last}`, `Herr ${last}`, `Herrn ${last}`, `Fr. ${last}`, `Hr. ${last}`);
    for (const m of multi) if (m.includes(" ") || m.length >= MIN_SINGLE_NAME_LEN) this.add(m, display);
    for (const single of [first, last]) {
      if (single.length >= MIN_SINGLE_NAME_LEN && !STOPWORDS.has(single.toLowerCase())) this.add(single, display);
    }
  }

  private add(pattern: string, replacement: string) {
    const key = pattern.toLowerCase();
    if (!key) return;
    const existing = this.map.get(key);
    if (existing !== undefined && existing !== replacement) {
      // Gleiche Schreibweise, verschiedene Personen → neutral ersetzen
      this.ambiguous.add(key);
      this.map.set(key, "[Name]");
    } else if (!this.ambiguous.has(key)) {
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
    return text.replace(this.regex, (m) => this.map.get(m.toLowerCase().replace(/\s+/g, " ")) ?? "[Name]");
  }
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
// Telefon: beginnt mit + oder 0, mindestens 7 Ziffern, Trennzeichen erlaubt
const PHONE_RE = /(?<![\p{L}\p{N}])(?:\+|0)[\d][\d \t/().-]{5,}\d(?![\p{L}\p{N}])/gu;
const DATE_LIKE_RE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;

export function redactContacts(text: string): string {
  return text.replace(EMAIL_RE, "[E-Mail]").replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    if (digits < 7 || DATE_LIKE_RE.test(m.trim())) return m;
    return "[Telefon]";
  });
}
