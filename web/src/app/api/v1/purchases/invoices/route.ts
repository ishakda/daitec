import { withApi, getPagination } from "@/lib/api";

export const GET = withApi(async ({ req, db, companyId, require }) => {
  await require("purchases.view");
  const { page, limit, offset } = getPagination(req);
  const url = new URL(req.url);
  const paymentStatus = url.searchParams.get("paymentStatus") || null;
  const supplierId = url.searchParams.get("supplierId") || null;

  const rows = await db.query(
    `select si.id, si.number, si.supplier_ref, si.invoice_date, si.due_date, si.total,
            si.paid_amount, si.payment_status, s.name as supplier_name
     from supplier_invoices si
     join suppliers s on s.id = si.supplier_id
     where si.company_id = $1 and si.deleted_at is null
       and ($2::text is null or si.payment_status = $2)
       and ($3::uuid is null or si.supplier_id = $3)
     order by si.created_at desc limit ${limit} offset ${offset}`,
    [companyId, paymentStatus, supplierId]
  );
  return { data: rows.rows, page, limit };
});
