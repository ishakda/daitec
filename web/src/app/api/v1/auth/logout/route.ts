import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { errorResponse } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const all = new URL(req.url).searchParams.get("all") === "true";
    await destroySession(all);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
