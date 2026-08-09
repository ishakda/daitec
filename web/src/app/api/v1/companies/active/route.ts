import { z } from "zod";
import { withApi, parseBody } from "@/lib/api";

export const GET = withApi(async ({ db, companyId }) => {
  const r = await db.query(
    `select id, name, legal_name, activity, nif, nis, rc, ai, address, city, wilaya,
            phone, email, logo_url, currency, default_tax_rate, invoice_footer
     from companies where id = $1`,
    [companyId]
  );
  return r.rows[0] ?? {};
});

const patchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  legal_name: z.string().max(200).optional(),
  activity: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  wilaya: z.string().max(80).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(160).optional(),
  nif: z.string().max(30).optional(),
  nis: z.string().max(30).optional(),
  rc: z.string().max(30).optional(),
  ai: z.string().max(30).optional(),
  invoice_footer: z.string().max(500).optional(),
});

const COLS = ["name","legal_name","activity","address","city","wilaya","phone","email","nif","nis","rc","ai","invoice_footer"];

export const PATCH = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("settings.manage");
  const body = await parseBody(req, patchSchema);
  const keys = COLS.filter((k) => (body as Record<string, unknown>)[k] !== undefined);
  if (keys.length) {
    await db.query(
      `update companies set ${keys.map((k, i) => `${k} = nullif($${i + 1}, '')`).join(", ")} where id = $${keys.length + 1}`,
      [...keys.map((k) => (body as Record<string, unknown>)[k]), companyId]
    );
  }
  await audit({ action: "update", entityType: "company", entityId: companyId, newValues: body });
  return { ok: true };
});
