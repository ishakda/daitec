import { z } from "zod";
import { withAuthOnly, parseBody, forbidden } from "@/lib/api";
import { adminPool } from "@/lib/db";
import { setActiveCompany } from "@/lib/auth";

const schema = z.object({ companyId: z.string().uuid() });

export const POST = withAuthOnly(async ({ req, session }) => {
  const { companyId } = await parseBody(req, schema);
  const m = await adminPool.query(
    `select 1 from company_members where company_id = $1 and user_id = $2 and status = 'active'`,
    [companyId, session.userId]
  );
  if (!m.rowCount) throw forbidden();
  await setActiveCompany(companyId);
  return { ok: true };
});
