import { z } from "zod";
import { withApi, parseBody, badRequest } from "@/lib/api";
import { NextRequest } from "next/server";

/**
 * Company settings key/value store (JSONB).
 * Known keys carry a schema; unknown keys are rejected.
 */
const SCHEMAS: Record<string, z.ZodType> = {
  receipt: z.object({
    paperWidth: z.enum(["58", "80"]).default("80"),
    headerText: z.string().max(300).default(""),
    footerText: z.string().max(300).default("Merci de votre visite !"),
    showNif: z.boolean().default(true),
    showTaxDetail: z.boolean().default(true),
    showCashier: z.boolean().default(true),
    showCustomer: z.boolean().default(true),
    showBarcode: z.boolean().default(false),
    autoPrint: z.boolean().default(false),
  }),
};

function keyOf(req: NextRequest): string {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const key = parts[parts.length - 1];
  if (!SCHEMAS[key]) throw badRequest("Unknown settings key.");
  return key;
}

export const GET = withApi(async ({ req, db, companyId }) => {
  const key = keyOf(req);
  const r = await db.query(
    `select value from settings where company_id = $1 and key = $2`, [companyId, key]);
  // Return stored value merged over schema defaults.
  const defaults = SCHEMAS[key].parse({});
  return { key, value: { ...(defaults as object), ...(r.rows[0]?.value ?? {}) } };
});

export const PUT = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("settings.manage");
  const key = keyOf(req);
  const value = await parseBody(req, SCHEMAS[key]);
  await db.query(
    `insert into settings (company_id, key, value) values ($1,$2,$3)
     on conflict (company_id, key) do update set value = $3, updated_at = now()`,
    [companyId, key, JSON.stringify(value)]
  );
  await audit({ action: "update", entityType: "settings", entityLabel: key, newValues: value });
  return { ok: true, value };
});
