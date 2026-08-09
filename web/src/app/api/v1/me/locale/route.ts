import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALES, LOCALE_COOKIE, Locale } from "@/i18n";

export async function POST(req: NextRequest) {
  const { locale } = await req.json().catch(() => ({}));
  if (!LOCALES.includes(locale as Locale)) {
    return NextResponse.json({ error: { code: "BAD_LOCALE", message: "Invalid locale." } }, { status: 400 });
  }
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  return NextResponse.json({ ok: true });
}
