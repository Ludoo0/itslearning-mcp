/**
 * Developer tool for the roadmap item "element type mapping": which LearningToolId / ExtensionId
 * combinations exist in the courses of a real account, and which file extensions appear with them?
 *
 *   bun run element-types            (current courses, root + one folder level)
 *
 * Output contains only ids, counts and file extensions taken from titles – no titles, names or URLs –
 * so it can be shared to build the mapping (file / link / page / test …).
 * Credentials: .env (Bun loads it automatically) or ITSL_BASE_URL / ITSL_USERNAME / ITSL_PASSWORD.
 */
import type { ApiResource } from "../../src/api/types";
import { createApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { setLogLevel } from "../../src/log";

const MAX_COURSES = 20;

process.env.DATA_DIR ??= ".data";
process.env.MCP_TRANSPORT = "stdio";
const cfg = loadConfig();
setLogLevel("error");
const { ctx } = createApp(cfg);
await ctx.ensureReady();

const isFolder = (r: ApiResource) => /folder/i.test(r.ElementType ?? "");
const extensionId = (r: ApiResource) => {
  try {
    return r.IconUrl ? (new URL(r.IconUrl).searchParams.get("ExtensionId") ?? "–") : "–";
  } catch {
    return "?";
  }
};
const titleExt = (r: ApiResource) => r.Title?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? "(none)";

type Row = { count: number; exts: Map<string, number> };
const rows = new Map<string, Row>();
let elements = 0;

const courses = (await ctx.it.courses(false)).slice(0, MAX_COURSES);
for (const c of courses) {
  const root = await ctx.it.courseResources(c.CourseId).catch(() => []);
  const sub = (
    await Promise.all(
      root
        .filter(isFolder)
        .slice(0, 5)
        .map((f) => ctx.it.folderResources(c.CourseId, f.ElementId).catch(() => [])),
    )
  ).flat();
  for (const r of [...root, ...sub].filter((x) => !isFolder(x))) {
    elements++;
    const key = `${r.ElementType ?? "?"} | LearningToolId=${r.LearningToolId ?? "–"} | ExtensionId=${extensionId(r)}`;
    const row = rows.get(key) ?? { count: 0, exts: new Map() };
    row.count++;
    row.exts.set(titleExt(r), (row.exts.get(titleExt(r)) ?? 0) + 1);
    rows.set(key, row);
  }
}

console.log(`Element types in ${courses.length} courses (${elements} elements; ids, counts and title extensions only)\n`);
for (const [key, row] of [...rows].sort((a, b) => b[1].count - a[1].count)) {
  const exts = [...row.exts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([e, n]) => `${e}:${n}`)
    .join(" ");
  console.log(`${String(row.count).padStart(4)}  ${key}\n      title extensions: ${exts}`);
}
process.exit(0);
