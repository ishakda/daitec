import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { adminPool } from "./db";

const SESSION_COOKIE = "sahla_session";
const COMPANY_COOKIE = "sahla_company";
const SESSION_DAYS = 30;

function secret() {
  return new TextEncoder().encode(
    process.env.AUTH_SECRET ?? "dev-only-secret-change-in-production"
  );
}

export type SessionUser = {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
};

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** Create a DB-backed session + signed cookie. */
export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string }
) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  const { rows } = await adminPool.query(
    `insert into auth_sessions (user_id, token_hash, user_agent, ip, expires_at)
     values ($1,$2,$3,$4,$5) returning id`,
    [userId, sha256(token), meta.userAgent ?? null, meta.ip ?? null, expiresAt]
  );
  const jwt = await new SignJWT({ sub: userId, sid: rows[0].id, tok: token })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86400,
    path: "/",
  });
}

/** Validate cookie + DB session. Returns null when unauthenticated. */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret());
    const { rows } = await adminPool.query(
      `select s.id as session_id, u.id, u.email, u.full_name
       from auth_sessions s join users u on u.id = s.user_id
       where s.id = $1 and s.token_hash = $2
         and s.revoked_at is null and s.expires_at > now() and u.is_active`,
      [payload.sid, sha256(String(payload.tok))]
    );
    if (!rows.length) return null;
    return {
      userId: rows[0].id,
      sessionId: rows[0].session_id,
      email: rows[0].email,
      fullName: rows[0].full_name,
    };
  } catch {
    return null;
  }
}

export async function destroySession(all = false) {
  const session = await getSession();
  if (session) {
    await adminPool.query(
      all
        ? `update auth_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`
        : `update auth_sessions set revoked_at = now() where id = $1`,
      [all ? session.userId : session.sessionId]
    );
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(COMPANY_COOKIE);
}

/** Active company selection (validated against membership on every request). */
export async function setActiveCompany(companyId: string) {
  const jar = await cookies();
  jar.set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 86400,
    path: "/",
  });
}

export async function getActiveCompanyId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COMPANY_COOKIE)?.value ?? null;
}
