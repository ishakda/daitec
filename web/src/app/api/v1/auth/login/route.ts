import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminPool } from "@/lib/db";
import { verifyPassword, createSession, setActiveCompany } from "@/lib/auth";
import { errorResponse, ApiError, parseBody } from "@/lib/api";

const schema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, schema);
    const { rows } = await adminPool.query(
      `select u.id, u.is_active, c.password_hash
       from users u join auth_credentials c on c.user_id = u.id
       where u.email = $1`,
      [body.email]
    );
    const invalid = new ApiError(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
    if (!rows.length || !rows[0].is_active) throw invalid;
    if (!(await verifyPassword(body.password, rows[0].password_hash))) throw invalid;

    const userId: string = rows[0].id;
    await createSession(userId, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
    });

    // Auto-select company when the user has exactly one.
    const memberships = await adminPool.query(
      `select m.company_id from company_members m
       join companies c on c.id = m.company_id and c.deleted_at is null and c.suspended_at is null
       where m.user_id = $1 and m.status = 'active'`,
      [userId]
    );
    if (memberships.rowCount === 1) {
      await setActiveCompany(memberships.rows[0].company_id);
    }

    return NextResponse.json({
      userId,
      companies: memberships.rows.map((r) => r.company_id),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
