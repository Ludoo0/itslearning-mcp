/**
 * Parent accounts – EXPERIMENTAL: built from the public API help pages (children/v1,
 * children/{childId}/courses|tasks/v1), NOT verified against a real parent account.
 *
 * Children are registered in the person registry with the role "child" (display "Child-7F3A"),
 * so their names are redacted in every text. Student accounts are unaffected: their
 * person/v1 has no Children, so no child endpoint is ever called.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiChild, ApiChildCourse } from "../api/types";
import type { AppContext } from "../context";
import { ToolError } from "../errors";
import { log } from "../log";
import { handler, ok } from "./result";

export const childIdInput = z
  .string()
  .regex(/^[0-9A-Fa-f]{8}$/, "childId is the 8-character key from itslearning_list_children")
  .optional()
  .describe(
    "Parent accounts only (experimental): childId from itslearning_list_children. Default: the only child, if there is exactly one. Ignored for student accounts.",
  );

function registerChild(ctx: AppContext, c: ApiChild) {
  ctx.redactor.people.register(c.PersonId, { firstName: c.FirstName, lastName: c.LastName, fullName: c.FullName }, "child");
}

/**
 * Children of the account, registered before anything is redacted. Empty for student accounts
 * (person/v1 without Children → no further request). children/v1 is preferred (person/v1's
 * Children is deprecated); if it fails, person/v1's Children are used.
 */
export async function loadChildren(ctx: AppContext): Promise<ApiChild[]> {
  const fromPerson = (await ctx.it.person()).Children ?? [];
  if (!fromPerson.length) return [];
  let children: ApiChild[] = fromPerson;
  try {
    const list = await ctx.it.children();
    if (list.length) children = list;
  } catch {
    log.warn("children/v1 not available – using the children from the person profile");
  }
  children = children.filter((c) => typeof c?.PersonId === "number");
  for (const c of children) registerChild(ctx, c);
  return children;
}

/**
 * Which child a call refers to: undefined = the account's own data (student account).
 * Parent account: the given childId (must be one of the children), otherwise the only child.
 */
/** Resolves the pseudonymous childId (personKey) to the child's PersonId – the real id never leaves the server. */
export async function resolveChildId(ctx: AppContext, childId: string | undefined): Promise<number | undefined> {
  const children = await loadChildren(ctx);
  if (!children.length) return undefined; // student account: childId is ignored
  if (childId !== undefined) {
    const match = children.find((c) => ctx.redactor.people.personKey(c.PersonId) === childId.toUpperCase());
    if (!match) throw new ToolError("INVALID_INPUT", "Unknown childId – use a childId from itslearning_list_children.");
    return match.PersonId;
  }
  if (children.length === 1) return children[0]!.PersonId;
  throw new ToolError("INVALID_INPUT", "This parent account has several children – pass childId (see itslearning_list_children).");
}

/** Courses of a child; their teachers are registered (reliable role) before titles are redacted. */
export async function childCourses(ctx: AppContext, childId: number): Promise<ApiChildCourse[]> {
  const courses = await ctx.it.childCourses(childId);
  for (const c of courses)
    for (const t of c.Teachers ?? [])
      ctx.redactor.people.register(t.PersonId, { firstName: t.FirstName, lastName: t.LastName, fullName: t.FullName }, "teacher");
  return courses;
}

export async function listChildren(ctx: AppContext) {
  const children = await loadChildren(ctx);
  return {
    parentAccount: children.length > 0,
    children: children.map((c) => ({ childId: ctx.redactor.people.personKey(c.PersonId), ...ctx.redactor.people.resolve(c.PersonId) })),
    total: children.length,
  };
}

export function registerChildTools(server: McpServer, ctx: AppContext) {
  server.registerTool(
    "itslearning_list_children",
    {
      title: "List children (parent accounts)",
      description:
        'EXPERIMENTAL, not verified against a real parent account. For parent accounts: lists the children as pseudonyms ("Child-7F3A") with childId – pass childId to itslearning_list_tasks, itslearning_list_courses or itslearning_overview. Student accounts get an empty list.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(ctx, "itslearning_list_children", async () => {
      const data = await listChildren(ctx);
      return ok(data.parentAccount ? `${data.total} children.` : "No children (not a parent account).", data);
    }),
  );
}
