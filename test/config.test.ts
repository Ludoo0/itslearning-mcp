import { describe, expect, test } from "bun:test";
import { ConfigError, DEFAULT_CLIENT_ID, loadConfig, normalizeBaseUrl } from "../src/config";

const base = { ITSL_BASE_URL: "demo.itslearning.com/", ITSL_USERNAME: "user", ITSL_PASSWORD: "pass" };

describe("config", () => {
  test("Defaults und URL-Normalisierung", () => {
    const c = loadConfig(base);
    expect(c.baseUrl).toBe("https://demo.itslearning.com");
    expect(c.clientId).toBe(DEFAULT_CLIENT_ID);
    expect(c.transport).toBe("stdio");
    expect(c.cacheTtlS).toBe(60);
    expect(c.redactTeachers).toBe(false);
    expect(c.teacherRoleTitles).toContain("Lehrer");
  });

  test("Pflichtfelder fehlen → ConfigError mit allen Problemen", () => {
    try {
      loadConfig({});
      throw new Error("sollte werfen");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("ITSL_BASE_URL");
      expect(msg).toContain("ITSL_USERNAME");
      expect(msg).toContain("ITSL_PASSWORD");
    }
  });

  test("*_FILE hat Vorrang vor dem direkten Wert", () => {
    const files: Record<string, string> = { "/run/secrets/pw": "aus-datei\n" };
    const c = loadConfig({ ...base, ITSL_PASSWORD: "direkt", ITSL_PASSWORD_FILE: "/run/secrets/pw" }, (p) => {
      const v = files[p];
      if (v === undefined) throw new Error("nicht da");
      return v;
    });
    expect(c.password).toBe("aus-datei");
  });

  test("http-Transport verlangt API-Key", () => {
    expect(() => loadConfig({ ...base, MCP_TRANSPORT: "http" })).toThrow(ConfigError);
    expect(loadConfig({ ...base, MCP_TRANSPORT: "http", MCP_API_KEY: "x".repeat(32) }).apiKey).toHaveLength(32);
  });

  test("ungültige Zahlen und Booleans werden abgelehnt", () => {
    expect(() => loadConfig({ ...base, MCP_PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, REDACT_TEACHERS: "vielleicht" })).toThrow(ConfigError);
    expect(loadConfig({ ...base, REDACT_TEACHERS: "true" }).redactTeachers).toBe(true);
  });

  test("normalizeBaseUrl lehnt Pfade ab", () => {
    expect(normalizeBaseUrl("http://x.itslearning.com")).toBe("http://x.itslearning.com");
    expect(() => normalizeBaseUrl("https://x.itslearning.com/index.aspx")).toThrow();
  });
});
