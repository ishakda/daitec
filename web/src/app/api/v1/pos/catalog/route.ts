import { withApi } from "@/lib/api";

/**
 * Offline POS catalog: every active product with prices, tax and barcodes,
 * plus a stock snapshot. The POS caches this in IndexedDB so scanning and
 * selling keep working without a connection.
 */
export const GET = withApi(async ({ db, companyId, require }) => {
  await require("pos.use");
  const rows = await db.query(
    `select p.id, p.sku, p.name, p.selling_price, p.tax_rate,
            coalesce((select sum(ib.quantity) from inventory_balances ib where ib.product_id = p.id), 0) as stock,
            coalesce((select array_agg(b.barcode) from barcodes b where b.product_id = p.id and b.variant_id is null), '{}') as barcodes
     from products p
     where p.company_id = $1 and p.deleted_at is null and p.status = 'active'
     order by p.name
     limit 5000`,
    [companyId]
  );
  return { data: rows.rows, fetchedAt: new Date().toISOString() };
});
