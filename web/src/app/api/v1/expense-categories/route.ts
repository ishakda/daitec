import { makeSimpleCrud, nameSchema } from "@/lib/simpleCrud";
const crud = makeSimpleCrud({
  table: "expense_categories", entityType: "expense_category",
  viewPerm: "expenses.view", managePerm: "expenses.edit",
  columns: { name: "name" }, schema: nameSchema,
});
export const GET = crud.list;
export const POST = crud.create;
