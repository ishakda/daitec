import { z } from "zod";
import { withApi, parseBody, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, can, require }) => {
  await require("products.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const categoryId = url.searchParams.get("categoryId");
  const status = url.searchParams.get("status") ?? "active";
  const lowStock = url.searchParams.get("lowStock") === "true";
  const showCost = await can("products.view_cost");

  const params: unknown[] = [companyId];
  let where = `p.company_id = $1 and p.deleted_at is null`;
  if (status !== "all") { params.push(status); where += ` and p.status = $${params.length}`; }
  if (categoryId) { params.push(categoryId); where += ` and p.category_id = $${params.length}`; }
  if (q) {
    params.push(`%${q}%`, q);
    where += ` and (p.name ilike $${params.length - 1} or p.sku ilike $${params.length - 1}
               or exists (select 1 from barcodes bc where bc.product_id = p.id and bc.barcode = $${params.length}))`;
  }
  if (lowStock) {
    where += ` and p.minimum_stock > 0 and coalesce((select sum(quantity) from inventory_balances ib where ib.product_id = p.id),0) <= p.minimum_stock`;
  }

  const count = await db.query(`select count(*)::int as total from products p where ${where}`, params);
  const rows = await db.query(
    `select p.id, p.sku, p.name, p.selling_price, p.wholesale_price, p.tax_rate,
            p.minimum_stock, p.status, p.has_variants, p.images,
            ${showCost ? "p.purchase_price," : ""}
            c.name as category_name, b.name as brand_name, u.abbreviation as unit,
            coalesce((select sum(quantity) from inventory_balances ib where ib.product_id = p.id),0) as stock,
            (select barcode from barcodes bc where bc.product_id = p.id and bc.is_primary limit 1) as barcode
     from products p
     left join product_categories c on c.id = p.category_id
     left join brands b on b.id = p.brand_id
     left join units u on u.id = p.unit_id
     where ${where}
     order by p.name
     limit ${limit} offset ${offset}`,
    params
  );
  return { data: rows.rows, page, limit, total: count.rows[0].total };
});

const createSchema = z.object({
  sku: z.string().min(1).max(60).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  categoryId: z.string().uuid().nullish(),
  brandId: z.string().uuid().nullish(),
  unitId: z.string().uuid().nullish(),
  purchasePrice: z.number().min(0).default(0),
  sellingPrice: z.number().min(0).default(0),
  wholesalePrice: z.number().min(0).nullish(),
  taxRate: z.number().min(0).max(100).default(19),
  minimumStock: z.number().min(0).default(0),
  maximumStock: z.number().min(0).nullish(),
  reorderQuantity: z.number().min(0).nullish(),
  defaultSupplierId: z.string().uuid().nullish(),
  barcodes: z.array(z.string().min(3).max(64)).default([]),
  variants: z.array(z.object({
    name: z.string().min(1),
    sku: z.string().optional(),
    attributes: z.record(z.string(), z.string()).default({}),
    sellingPrice: z.number().min(0).nullish(),
    purchasePrice: z.number().min(0).nullish(),
    barcode: z.string().min(3).max(64).nullish(),
  })).default([]),
  initialStock: z.object({
    warehouseId: z.string().uuid(),
    quantity: z.number().positive(),
    unitCost: z.number().min(0).default(0),
  }).nullish(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("products.create");
  const body = await parseBody(req, createSchema);

  const sku = body.sku ?? `P-${Date.now().toString(36).toUpperCase()}`;
  const product = await db.query(
    `insert into products (company_id, sku, name, description, category_id, brand_id, unit_id,
        purchase_price, selling_price, wholesale_price, tax_rate, minimum_stock, maximum_stock,
        reorder_quantity, default_supplier_id, has_variants)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     returning id, sku, name`,
    [companyId, sku, body.name, body.description ?? null, body.categoryId ?? null,
     body.brandId ?? null, body.unitId ?? null, body.purchasePrice, body.sellingPrice,
     body.wholesalePrice ?? null, body.taxRate, body.minimumStock, body.maximumStock ?? null,
     body.reorderQuantity ?? null, body.defaultSupplierId ?? null, body.variants.length > 0]
  );
  const productId = product.rows[0].id;

  for (let i = 0; i < body.barcodes.length; i++) {
    await db.query(
      `insert into barcodes (company_id, product_id, barcode, is_primary) values ($1,$2,$3,$4)`,
      [companyId, productId, body.barcodes[i], i === 0]
    );
  }
  for (const v of body.variants) {
    const variant = await db.query(
      `insert into product_variants (company_id, product_id, name, sku, attributes, selling_price, purchase_price)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [companyId, productId, v.name, v.sku ?? null, JSON.stringify(v.attributes),
       v.sellingPrice ?? null, v.purchasePrice ?? null]
    );
    if (v.barcode) {
      await db.query(
        `insert into barcodes (company_id, product_id, variant_id, barcode) values ($1,$2,$3,$4)`,
        [companyId, productId, variant.rows[0].id, v.barcode]
      );
    }
  }
  if (body.initialStock && body.variants.length === 0) {
    await db.query(
      `insert into stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, unit_cost, reference_type, created_by)
       values ($1,$2,$3,'initial',$4,$5,'adjustment',$6)`,
      [companyId, body.initialStock.warehouseId, productId,
       body.initialStock.quantity, body.initialStock.unitCost, session.userId]
    );
  }

  await audit({ action: "create", entityType: "product", entityId: productId, entityLabel: body.name, newValues: body });
  return { id: productId, sku: product.rows[0].sku, name: product.rows[0].name };
});
