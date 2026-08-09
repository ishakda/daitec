import { z } from "zod";
import { withApi, parseBody, pathId, notFound } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("products.view");
  const id = pathId(req);
  const showCost = await can("products.view_cost");

  const p = await db.query(
    `select p.*, c.name as category_name, b.name as brand_name, u.name as unit_name
     from products p
     left join product_categories c on c.id = p.category_id
     left join brands b on b.id = p.brand_id
     left join units u on u.id = p.unit_id
     where p.id = $1 and p.company_id = $2 and p.deleted_at is null`,
    [id, companyId]
  );
  if (!p.rowCount) throw notFound("Product");
  const product = p.rows[0];
  if (!showCost) { delete product.purchase_price; }

  const [variants, barcodes, stock] = await Promise.all([
    db.query(`select * from product_variants where product_id = $1 and deleted_at is null order by name`, [id]),
    db.query(`select id, barcode, variant_id, is_primary from barcodes where product_id = $1`, [id]),
    db.query(
      `select w.id as warehouse_id, w.name as warehouse_name, ib.quantity, ${showCost ? "ib.avg_cost" : "null as avg_cost"}, ib.variant_id
       from inventory_balances ib join warehouses w on w.id = ib.warehouse_id
       where ib.product_id = $1 order by w.name`,
      [id]
    ),
  ]);
  return { ...product, variants: variants.rows, barcodes: barcodes.rows, stock: stock.rows };
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  categoryId: z.string().uuid().nullish(),
  brandId: z.string().uuid().nullish(),
  unitId: z.string().uuid().nullish(),
  purchasePrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  wholesalePrice: z.number().min(0).nullish(),
  taxRate: z.number().min(0).max(100).optional(),
  minimumStock: z.number().min(0).optional(),
  maximumStock: z.number().min(0).nullish(),
  reorderQuantity: z.number().min(0).nullish(),
  defaultSupplierId: z.string().uuid().nullish(),
  status: z.enum(["active", "archived", "draft"]).optional(),
  barcodes: z.array(z.string().min(3).max(64)).optional(),
});

const COLS: Record<string, string> = {
  name: "name", description: "description", categoryId: "category_id", brandId: "brand_id",
  unitId: "unit_id", purchasePrice: "purchase_price", sellingPrice: "selling_price",
  wholesalePrice: "wholesale_price", taxRate: "tax_rate", minimumStock: "minimum_stock",
  maximumStock: "maximum_stock", reorderQuantity: "reorder_quantity",
  defaultSupplierId: "default_supplier_id", status: "status",
};

export const PATCH = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("products.edit");
  const id = pathId(req);
  const body = await parseBody(req, patchSchema);

  const existing = await db.query(
    `select * from products where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Product");

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(COLS)) {
    if (key in body) {
      params.push((body as Record<string, unknown>)[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length) {
    params.push(id, companyId);
    await db.query(
      `update products set ${sets.join(", ")} where id = $${params.length - 1} and company_id = $${params.length}`,
      params
    );
  }
  if (body.barcodes) {
    await db.query(`delete from barcodes where product_id = $1 and variant_id is null`, [id]);
    for (let i = 0; i < body.barcodes.length; i++) {
      await db.query(
        `insert into barcodes (company_id, product_id, barcode, is_primary) values ($1,$2,$3,$4)`,
        [companyId, id, body.barcodes[i], i === 0]
      );
    }
  }

  await audit({
    action: "update", entityType: "product", entityId: id,
    entityLabel: existing.rows[0].name,
    oldValues: Object.fromEntries(Object.entries(COLS).filter(([k]) => k in body).map(([k, c]) => [k, existing.rows[0][c]])),
    newValues: body,
  });
  return { ok: true };
});

export const DELETE = withApi(async ({ req, db, companyId, require, audit }) => {
  await require("products.delete");
  const id = pathId(req);
  const existing = await db.query(
    `select name from products where id = $1 and company_id = $2 and deleted_at is null`,
    [id, companyId]
  );
  if (!existing.rowCount) throw notFound("Product");
  await db.query(
    `update products set deleted_at = now(), status = 'archived' where id = $1 and company_id = $2`,
    [id, companyId]
  );
  await audit({ action: "delete", entityType: "product", entityId: id, entityLabel: existing.rows[0].name });
  return { ok: true };
});
