import { makeSimpleCrud, nameSchema } from "@/lib/simpleCrud";
const crud = makeSimpleCrud({
  table: "brands", entityType: "brand",
  viewPerm: "products.view", managePerm: "products.edit",
  columns: { name: "name" }, schema: nameSchema,
});
export const GET = crud.list;
export const POST = crud.create;
