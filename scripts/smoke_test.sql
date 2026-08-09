-- Smoke test: tenant isolation + inventory ledger math.
-- Run as superuser; it switches to sahla_app for RLS checks.
\set ON_ERROR_STOP on

begin;

-- Seed two tenants (privileged path, like signup does)
insert into users (id, email, full_name) values
  ('11111111-1111-1111-1111-111111111111','a@test.dz','User A'),
  ('22222222-2222-2222-2222-222222222222','b@test.dz','User B');

insert into companies (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000000','Company A'),
  ('bbbbbbbb-0000-0000-0000-000000000000','Company B');

insert into roles (id, company_id, name, is_system) values
  ('aaaaaaaa-1111-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000000','Owner',true),
  ('bbbbbbbb-1111-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000000','Owner',true);

insert into company_members (company_id, user_id, role_id, is_owner) values
  ('aaaaaaaa-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','aaaaaaaa-1111-0000-0000-000000000000',true),
  ('bbbbbbbb-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','bbbbbbbb-1111-0000-0000-000000000000',true);

insert into warehouses (id, company_id, name, is_default) values
  ('aaaaaaaa-2222-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000000','Dépôt A',true),
  ('bbbbbbbb-2222-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000000','Dépôt B',true);

insert into products (id, company_id, sku, name, selling_price) values
  ('aaaaaaaa-3333-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-000000000000','SKU-A1','Produit A1',1500),
  ('bbbbbbbb-3333-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-000000000000','SKU-B1','Produit B1',900);

commit;

-- ============ RLS: switch to the app role as User A ============
set role sahla_app;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo '--- User A sees only Company A products (expect 1 row, SKU-A1):'
select sku, name from products;

\echo '--- User A cannot insert into Company B (expect ERROR):'
\set ON_ERROR_STOP off
insert into products (company_id, sku, name) values ('bbbbbbbb-0000-0000-0000-000000000000','HACK','Cross-tenant');
\set ON_ERROR_STOP on

\echo '--- Inventory: receive 10 @ 100, then 10 @ 200 (expect qty 20, avg 150):'
insert into stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, unit_cost, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-2222-0000-0000-000000000000','aaaaaaaa-3333-0000-0000-000000000000','purchase_receipt',10,100,'11111111-1111-1111-1111-111111111111');
insert into stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, unit_cost, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-2222-0000-0000-000000000000','aaaaaaaa-3333-0000-0000-000000000000','purchase_receipt',10,200,'11111111-1111-1111-1111-111111111111');
select quantity, avg_cost from inventory_balances where product_id='aaaaaaaa-3333-0000-0000-000000000000';

\echo '--- Sell 25 with stock 20 (expect INSUFFICIENT_STOCK error):'
\set ON_ERROR_STOP off
insert into stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, unit_cost)
values ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-2222-0000-0000-000000000000','aaaaaaaa-3333-0000-0000-000000000000','sale',-25,150);
\set ON_ERROR_STOP on

\echo '--- Sell 5 (expect remaining qty 15, avg still 150):'
insert into stock_movements (company_id, warehouse_id, product_id, movement_type, quantity, unit_cost)
values ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-2222-0000-0000-000000000000','aaaaaaaa-3333-0000-0000-000000000000','sale',-5,150);
select quantity, avg_cost from inventory_balances where product_id='aaaaaaaa-3333-0000-0000-000000000000';

\echo '--- Ledger immutability (expect ERROR):'
\set ON_ERROR_STOP off
update stock_movements set quantity = 999 where product_id='aaaaaaaa-3333-0000-0000-000000000000';
delete from stock_movements where product_id='aaaaaaaa-3333-0000-0000-000000000000';
\set ON_ERROR_STOP on

\echo '--- Document numbering (expect FAC prefix-less 2026-00001 then 2026-00002):'
select next_document_number('aaaaaaaa-0000-0000-0000-000000000000','invoice');
select next_document_number('aaaaaaaa-0000-0000-0000-000000000000','invoice');

\echo '--- User B sees zero Company A movements:'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as visible_movements from stock_movements;

reset role;
\echo 'SMOKE TEST DONE'
