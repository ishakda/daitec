import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("suppliers.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const withDebt = url.searchParams.get("withDebt") === "true";
  const showDebt = await can("suppliers.view_debt");

  const params: unknown[] = [companyId];
  let where = `company_id = $1 and deleted_at is null`;
  if (q) {
    params.push(`%${q}%`);
    where += ` and (name ilike $${params.length} or phone ilike $${params.length} or company_name ilike $${params.length})`;
  }
  if (withDebt) where += ` and balance > 0`;

  const count = await db.query(`select count(*)::int as total from suppliers where ${where}`, params);
  const rows = await db.query(
    `select id, code, name, company_name, phone, email, city, wilaya, is_active,
            ${showDebt ? "balance, credit_limit," : ""} created_at
     from suppliers where ${where}
     order by name limit ${limit} offset ${offset}`,
    params
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total };
});

export const supplierSchema = z.object({
  name: z.string().min(1).max(160),
  companyName: z.string().max(200).nullish(),
  contactName: z.string().max(160).nullish(),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish().or(z.literal("").transform(() => null)),
  address: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  wilaya: z.string().max(80).nullish(),
  nif: z.string().max(30).nullish(),
  nis: z.string().max(30).nullish(),
  rc: z.string().max(30).nullish(),
  ai: z.string().max(30).nullish(),
  creditLimit: z.number().min(0).nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).nullish(),
  notes: z.string().max(2000).nullish(),
});

const COLS: Record<string, string> = {
  name: "name", companyName: "company_name", contactName: "contact_name", phone: "phone", email: "email",
  address: "address", city: "city", wilaya: "wilaya", nif: "nif", nis: "nis",
  rc: "rc", ai: "ai", creditLimit: "credit_limit",
  paymentTermsDays: "payment_terms_days", notes: "notes",
};

export const POST = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("suppliers.create");
  const body = await parseBody(req, supplierSchema);
  const keys = Object.keys(COLS).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
  const r = await db.query(
    `insert into suppliers (company_id${keys.map((k) => `, ${COLS[k]}`).join("")})
     values ($1${keys.map((_, i) => `, $${i + 2}`).join("")}) returning id`,
    [companyId, ...keys.map((k) => (body as Record<string, unknown>)[k])]
  );
  await audit({ action: "create", entityType: "supplier", entityId: r.rows[0].id, entityLabel: body.name, newValues: body });
  return { id: r.rows[0].id };
});
