import { describe, expect, test } from "bun:test";
import { ConfigError, DEFAULT_CLIENT_ID, loadConfig, normalizeBaseUrl } from "../src/config";

const base = { ITSL_BASE_URL: "demo.itslearning.com/", ITSL_USERNAME: "user", ITSL_PASSWORD: "pass" };

describe("config", () => {
  test("defaults and URL normalization", () => {
    const c = loadConfig(base);
    expect(c.baseUrl).toBe("https://demo.itslearning.com");
    expect(c.clientId).toBe(DEFAULT_CLIENT_ID);
    expect(c.transport).toBe("stdio");
    expect(c.cacheTtlS).toBe(60);
    expect(c.redactTeachers).toBe(false);
    expect(c.redactionLanguage).toBe("en");
    expect(c.redactionKeepWords).toEqual([]);
    expect(c.teacherRoleTitles).toEqual(expect.arrayContaining(["Teacher", "Lehrer"]));
  });

  test("REDACTION_LANGUAGE and REDACTION_KEEP_WORDS", () => {
    const c = loadConfig({ ...base, REDACTION_LANGUAGE: "de", REDACTION_KEEP_WORDS: " Oslo , Bergen ,," });
    expect(c.redactionLanguage).toBe("de");
    expect(c.redactionKeepWords).toEqual(["oslo", "bergen"]);
    expect(() => loadConfig({ ...base, REDACTION_LANGUAGE: "fr" })).toThrow(ConfigError);
  });

  test("missing required fields → ConfigError listing all problems", () => {
    try {
      loadConfig({});
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const msg = (e as ConfigError).message;
      expect(msg).toContain("ITSL_BASE_URL");
      expect(msg).toContain("ITSL_USERNAME");
      expect(msg).toContain("ITSL_PASSWORD");
    }
  });

  test("*_FILE takes precedence over the direct value", () => {
    const files: Record<string, string> = { "/run/secrets/pw": "from-file\n" };
    const c = loadConfig({ ...base, ITSL_PASSWORD: "direct", ITSL_PASSWORD_FILE: "/run/secrets/pw" }, (p) => {
      const v = files[p];
      if (v === undefined) throw new Error("missing");
      return v;
    });
    expect(c.password).toBe("from-file");
  });

  test("http transport requires an API key", () => {
    expect(() => loadConfig({ ...base, MCP_TRANSPORT: "http" })).toThrow(ConfigError);
    expect(loadConfig({ ...base, MCP_TRANSPORT: "http", MCP_API_KEY: "x".repeat(32) }).apiKey).toHaveLength(32);
  });

  test("invalid numbers and booleans are rejected", () => {
    expect(() => loadConfig({ ...base, MCP_PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, REDACT_TEACHERS: "maybe" })).toThrow(ConfigError);
    expect(loadConfig({ ...base, REDACT_TEACHERS: "true" }).redactTeachers).toBe(true);
  });

  test("normalizeBaseUrl rejects paths", () => {
    expect(normalizeBaseUrl("http://x.itslearning.com")).toBe("http://x.itslearning.com");
    expect(() => normalizeBaseUrl("https://x.itslearning.com/index.aspx")).toThrow();
  });
});
