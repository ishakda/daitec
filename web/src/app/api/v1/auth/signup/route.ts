import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminPool } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { errorResponse, badRequest, parseBody } from "@/lib/api";

const schema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  fullName: z.string().min(2).max(120),
  locale: z.enum(["fr", "ar", "en"]).default("fr"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, schema);

    const existing = await adminPool.query(`select 1 from users where email = $1`, [body.email]);
    if (existing.rowCount) throw badRequest("An account with this email already exists.");

    const client = await adminPool.connect();
    let userId: string;
    try {
      await client.query("begin");
      const user = await client.query(
        `insert into users (email, full_name, locale) values ($1,$2,$3) returning id`,
        [body.email, body.fullName, body.locale]
      );
      userId = user.rows[0].id;
      await client.query(
        `insert into auth_credentials (user_id, password_hash) values ($1,$2)`,
        [userId, await hashPassword(body.password)]
      );
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await createSession(userId, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0] ?? undefined,
    });
    return NextResponse.json({ userId }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
