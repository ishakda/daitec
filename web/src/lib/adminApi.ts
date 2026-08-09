import { NextRequest, NextResponse } from "next/server";
import { getSession, SessionUser } from "./auth";
import { adminPool } from "./db";
import { ApiError, errorResponse } from "./api";

/**
 * Platform Super Admin wrapper. Runs on the PRIVILEGED pool —
 * tenant RLS is never weakened; operator access is a separate,
 * explicitly-granted capability (platform_admins) that the tenant
 * application role cannot even read.
 * Every mutating action must call ctx.paudit().
 */
export type AdminCtx = {
  req: NextRequest;
  session: SessionUser;
  paudit: (action: string, companyId?: string | null, details?: unknown) => Promise<void>;
};

export function withPlatformAdmin(
  handler: (ctx: AdminCtx) => Promise<NextResponse | object>
) {
  return async (req: NextRequest) => {
    try {
      const session = await getSession();
      if (!session) throw new ApiError(401, "UNAUTHORIZED", "Authentication required.");
      const admin = await adminPool.query(
        `select 1 from platform_admins where user_id = $1`, [session.userId]);
      if (!admin.rowCount) throw new ApiError(403, "NOT_PLATFORM_ADMIN", "Platform admin access required.");

      const paudit = async (action: string, companyId?: string | null, details?: unknown) => {
        await adminPool.query(
          `insert into platform_audit_logs (admin_user_id, action, company_id, details, ip)
           values ($1,$2,$3,$4,$5)`,
          [session.userId, action, companyId ?? null,
           details ? JSON.stringify(details) : null,
           req.headers.get("x-forwarded-for")?.split(",")[0] ?? null]
        );
      };

      const result = await handler({ req, session, paudit });
      if (result instanceof NextResponse) return result;
      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
