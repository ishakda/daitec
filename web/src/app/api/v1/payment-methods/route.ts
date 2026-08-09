import { z } from "zod";
import { makeSimpleCrud } from "@/lib/simpleCrud";
const schema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(1).max(30),
  kind: z.enum(["cash","card","bank","cheque","credit","other"]).default("other"),
});
const crud = makeSimpleCrud({
  table: "payment_methods", entityType: "payment_method",
  viewPerm: "payments.view", managePerm: "settings.manage",
  columns: { name: "name", code: "code", kind: "kind" },
  schema, softDelete: false, orderBy: "position, name",
});
export const GET = crud.list;
export const POST = crud.create;
