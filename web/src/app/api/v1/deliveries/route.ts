import { z } from "zod";
import { withApi, parseBody, getPagination, notFound, badRequest } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, session, can, require }) => {
  await require("deliveries.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || null;
  const active = url.searchParams.get("active") === "true";
  // Livreurs without assign rights only see their own deliveries.
  const restrictToSelf = !(await can("deliveries.assign"));
  const courierId = restrictToSelf ? session.userId : url.searchParams.get("courierId") || null;

  const rows = await db.query(
    `select d.id, d.number, d.status, d.address, d.city, d.phone, d.latitude, d.longitude,
            d.cod_amount, d.notes, d.failure_reason, d.created_at, d.assigned_at, d.delivered_at, d.qr_verified_at,
            c.name as customer_name, u.full_name as courier_name, d.courier_id,
            s.number as sale_number, s.id as sale_id, s.total as sale_total,
            (select count(*)::int from delivery_proofs dp where dp.delivery_id = d.id) as proof_count
     from deliveries d
     left join customers c on c.id = d.customer_id
     left join users u on u.id = d.courier_id
     left join sales s on s.id = d.sale_id
     where d.company_id = $1 and d.deleted_at is null
       and ($2::text is null or d.status = $2)
       and ($3::uuid is null or d.courier_id = $3)
       and (not $4 or d.status in ('pending','assigned','picked_up','out_for_delivery'))
     order by d.created_at desc limit ${limit} offset ${offset}`,
    [companyId, status, courierId, active]
  );
  const count = await db.query(
    `select count(*)::int as total from deliveries d
     where d.company_id = $1 and d.deleted_at is null
       and ($2::text is null or d.status = $2)
       and ($3::uuid is null or d.courier_id = $3)
       and (not $4 or d.status in ('pending','assigned','picked_up','out_for_delivery'))`,
    [companyId, status, courierId, active]
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total };
});

const createSchema = z.object({
  saleId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  courierId: z.string().uuid().nullish(),
  address: z.string().max(300).nullish(),
  city: z.string().max(120).nullish(),
  phone: z.string().max(30).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  codAmount: z.number().min(0).default(0),
  notes: z.string().max(1000).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("deliveries.create");
  const body = await parseBody(req, createSchema);

  // Snapshot destination from the customer when not provided explicitly.
  let dest = {
    customerId: body.customerId ?? null, address: body.address ?? null, city: body.city ?? null,
    phone: body.phone ?? null, lat: body.latitude ?? null, lng: body.longitude ?? null,
    cod: body.codAmount,
  };
  if (body.saleId) {
    const s = await db.query(
      `select s.customer_id, s.total, s.paid_amount, c.address, c.city, c.phone, c.latitude, c.longitude
       from sales s left join customers c on c.id = s.customer_id
       where s.id = $1 and s.company_id = $2 and s.deleted_at is null`,
      [body.saleId, companyId]
    );
    if (!s.rowCount) throw notFound("Sale");
    const r = s.rows[0];
    dest = {
      customerId: dest.customerId ?? r.customer_id,
      address: dest.address ?? r.address, city: dest.city ?? r.city, phone: dest.phone ?? r.phone,
      lat: dest.lat ?? (r.latitude != null ? Number(r.latitude) : null),
      lng: dest.lng ?? (r.longitude != null ? Number(r.longitude) : null),
      // default COD = remaining due on the sale
      cod: body.codAmount || Math.max(0, Number(r.total) - Number(r.paid_amount)),
    };
  } else if (body.customerId) {
    const c = await db.query(
      `select address, city, phone, latitude, longitude from customers
       where id = $1 and company_id = $2 and deleted_at is null`,
      [body.customerId, companyId]
    );
    if (!c.rowCount) throw notFound("Customer");
    const r = c.rows[0];
    dest.address ??= r.address; dest.city ??= r.city; dest.phone ??= r.phone;
    dest.lat ??= r.latitude != null ? Number(r.latitude) : null;
    dest.lng ??= r.longitude != null ? Number(r.longitude) : null;
  }
  if (!body.saleId && !body.customerId && !body.address) {
    throw badRequest("A delivery needs a sale, a customer or an address.");
  }

  const num = await db.query(`select next_document_number($1,'delivery') as n`, [companyId]);
  const d = await db.query(
    `insert into deliveries (company_id, number, sale_id, customer_id, courier_id, status,
        address, city, phone, latitude, longitude, cod_amount, notes, assigned_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id, number`,
    [companyId, num.rows[0].n, body.saleId ?? null, dest.customerId, body.courierId ?? null,
     body.courierId ? "assigned" : "pending",
     dest.address, dest.city, dest.phone, dest.lat, dest.lng, dest.cod,
     body.notes ?? null, body.courierId ? new Date() : null, session.userId]
  );
  await audit({
    action: "create", entityType: "delivery", entityId: d.rows[0].id, entityLabel: d.rows[0].number,
    newValues: { saleId: body.saleId, courierId: body.courierId, cod: dest.cod },
  });
  return { id: d.rows[0].id, number: d.rows[0].number };
});
