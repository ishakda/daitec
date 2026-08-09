import { z } from "zod";
import { withAuthOnly, parseBody } from "@/lib/api";
import { provisionCompany } from "@/lib/provision";
import { setActiveCompany } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(2).max(160),
  legalName: z.string().max(200).optional(),
  activity: z.string().max(120).optional(),
  nif: z.string().max(30).optional(),
  nis: z.string().max(30).optional(),
  rc: z.string().max(30).optional(),
  ai: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  wilaya: z.string().max(80).optional(),
  phone: z.string().max(30).optional(),
  currency: z.string().length(3).default("DZD"),
  defaultTaxRate: z.number().min(0).max(100).default(19),
});

export const POST = withAuthOnly(async ({ req, session }) => {
  const body = await parseBody(req, schema);
  const { companyId } = await provisionCompany({ ownerUserId: session.userId, ...body });
  await setActiveCompany(companyId);
  return { companyId };
});
