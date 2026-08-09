import { withApi, badRequest } from "@/lib/api";

/**
 * Ultra-fast POS lookup: exact barcode match first (indexed),
 * then name/SKU substring search. Returns ≤ 12 rows.
 */
export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("pos.use");
  const url = new URL(req.url);
  const barcode = url.searchParams.get("barcode")?.trim();
  const q = url.searchParams.get("q")?.trim();
  const warehouseId = url.searchParams.get("warehouseId") || null;

  if (barcode) {
    const r = await db.query(
      `select p.id, p.sku, p.name, p.tax_rate, bc.variant_id,
              v.name as variant_name, coalesce(v.selling_price, p.selling_price) as price,
              coalesce((select sum(quantity) from inventory_balances ib
                        where ib.product_id = p.id
                          and coalesce(ib.variant_id,'00000000-0000-0000-0000-000000000000') = coalesce(bc.variant_id,'00000000-0000-0000-0000-000000000000')
                          and ($3::uuid is null or ib.warehouse_id = $3)),0) as stock
       from barcodes bc
       join products p on p.id = bc.product_id and p.deleted_at is null and p.status = 'active'
       left join product_variants v on v.id = bc.variant_id
       where bc.company_id = $1 and bc.barcode = $2`,
      [companyId, barcode, warehouseId]
    );
    return { data: r.rows, matched: "barcode" };
  }

  if (!q || q.length < 1) throw badRequest("Provide barcode or q.");
  const r = await db.query(
    `select p.id, p.sku, p.name, p.selling_price as price, p.tax_rate,
            null as variant_id, null as variant_name,
            coalesce((select sum(quantity) from inventory_balances ib
                      where ib.product_id = p.id
                        and ($3::uuid is null or ib.warehouse_id = $3)),0) as stock
     from products p
     where p.company_id = $1 and p.deleted_at is null and p.status = 'active'
       and (p.name ilike $2 or p.sku ilike $2)
     order by position(lower($4) in lower(p.name)), p.name
     limit 12`,
    [companyId, `%${q}%`, warehouseId, q]
  );
  return { data: r.rows, matched: "search" };
});
