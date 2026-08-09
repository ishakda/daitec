import { NextRequest, NextResponse } from "next/server";
import { PoolClient } from "pg";
import { ZodType } from "zod";
import { getSession, getActiveCompanyId, SessionUser } from "./auth";
import { withTenant } from "./db";

/** Structured, user-safe API errors. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Authentication required.");
export const forbidden = (perm?: string) =>
  new ApiError(403, "FORBIDDEN", perm ? `Missing permission: ${perm}` : "Access denied.");
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`);
export const badRequest = (msg: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", msg, details);

export type Ctx = {
  req: NextRequest;
  session: SessionUser;
  companyId: string;
  /** RLS-scoped client — every query is tenant-isolated at the DB level. */
  db: PoolClient;
  /** true when the member has this permission (or is owner). */
  can: (perm: string) => Promise<boolean>;
  /** throws 403 unless the member has this permission. */
  require: (perm: string) => Promise<void>;
  /** append to the immutable audit log (same transaction). */
  audit: (entry: AuditEntry) => Promise<void>;
};

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
};

/**
 * Wraps an API route handler with: session auth → active-company check →
 * RLS-scoped transaction → permission helpers → audit → error mapping.
 * The whole handler runs in ONE transaction: any thrown error rolls back
 * every write (sale + items + payments + stock movements + audit = atomic).
 */
export function withApi(
  handler: (ctx: Ctx) => Promise<NextResponse | object>
): (req: NextRequest, extra?: unknown) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    try {
      const session = await getSession();
      if (!session) throw unauthorized();
      const companyId = await getActiveCompanyId();
      if (!companyId) throw new ApiError(400, "NO_COMPANY", "No active company selected.");

      const result = await withTenant(session.userId, async (db) => {
        // Validate membership through RLS itself: a non-member sees no row.
        const m = await db.query(
          `select c.suspended_at from company_members cm
           join companies c on c.id = cm.company_id
           where cm.company_id = $1 and cm.user_id = $2 and cm.status = 'active'`,
          [companyId, session.userId]
        );
        if (!m.rowCount) throw forbidden();
        if (m.rows[0].suspended_at) {
          throw new ApiError(403, "COMPANY_SUSPENDED",
            "This company account is suspended. Contact support.");
        }

        const can = async (perm: string) => {
          const r = await db.query(`select has_permission($1, $2) as ok`, [companyId, perm]);
          return r.rows[0]?.ok === true;
        };
        const requirePerm = async (perm: string) => {
          if (!(await can(perm))) throw forbidden(perm);
        };
        const audit = async (e: AuditEntry) => {
          await db.query(
            `insert into audit_logs (company_id, user_id, action, entity_type, entity_id, entity_label, old_values, new_values, ip, user_agent)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              companyId,
              session.userId,
              e.action,
              e.entityType,
              e.entityId ?? null,
              e.entityLabel ?? null,
              e.oldValues ? JSON.stringify(e.oldValues) : null,
              e.newValues ? JSON.stringify(e.newValues) : null,
              req.headers.get("x-forwarded-for")?.split(",")[0] ?? null,
              req.headers.get("user-agent"),
            ]
          );
        };

        return handler({ req, session, companyId, db, can, require: requirePerm, audit });
      });

      if (result instanceof NextResponse) return result;
      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Same wrapper for routes that must work before a company exists (onboarding). */
export function withAuthOnly(
  handler: (args: { req: NextRequest; session: SessionUser }) => Promise<NextResponse | object>
) {
  return async (req: NextRequest) => {
    try {
      const session = await getSession();
      if (!session) throw unauthorized();
      const result = await handler({ req, session });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details ?? null } },
      { status: err.status }
    );
  }
  const msg = err instanceof Error ? err.message : "";
  // Translate known DB-enforced business rules into friendly errors.
  if (msg.startsWith("INSUFFICIENT_STOCK")) {
    return NextResponse.json(
      { error: { code: "INSUFFICIENT_STOCK", message: "Stock is insufficient for this operation.", details: msg } },
      { status: 409 }
    );
  }
  if (msg.includes("duplicate key")) {
    return NextResponse.json(
      { error: { code: "DUPLICATE", message: "A record with the same unique value already exists.", details: null } },
      { status: 409 }
    );
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again.", details: null } },
    { status: 500 }
  );
}

/** Parse + validate a JSON body against a zod schema (400 on failure). */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest("Invalid JSON body.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw badRequest("Validation failed.", parsed.error.flatten());
  }
  return parsed.data;
}

/** Extract a UUID path segment (fromEnd=0 → last segment). */
export function pathId(req: NextRequest, fromEnd = 0): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const seg = parts[parts.length - 1 - fromEnd];
  if (!/^[0-9a-f-]{36}$/i.test(seg ?? "")) throw badRequest("Invalid id in URL.");
  return seg;
}

/** Pagination helpers */
export function getPagination(req: NextRequest, defaultLimit = 25, maxLimit = 100) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}
