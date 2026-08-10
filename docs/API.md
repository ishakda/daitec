# API Reference — `/api/v1`

All endpoints require the session cookie (set by `/auth/login` or
`/auth/signup`) and an active company (set at login or via
`/me/active-company`). Requests and responses are JSON.

**Errors** are structured and user-safe:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "…", "details": null } }
```

Common codes: `UNAUTHORIZED` 401 · `FORBIDDEN` 403 (missing permission) ·
`NOT_FOUND` 404 · `BAD_REQUEST` 400 (zod details included) ·
`INSUFFICIENT_STOCK` 409 · `OVERPAYMENT` 409 · `CREDIT_LIMIT_EXCEEDED` 409 ·
`DUPLICATE` 409 · `REGISTER_ALREADY_OPEN` 409 · `RETURN_QTY_EXCEEDED` 409 ·
`OVER_RECEPTION` 409.

**Pagination:** `?page=1&limit=25` (max 100) → `{ data, page, limit, total }`.

## Auth & session
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | `{email, password, fullName, locale?}` |
| POST | `/auth/login` | auto-selects company when user has exactly one |
| POST | `/auth/logout?all=true` | `all` revokes every session |
| GET | `/me` | user, companies, active company, permissions (`["*"]` for owners) |
| POST | `/me/active-company` | `{companyId}` (membership validated) |
| POST | `/me/locale` | `{locale: "fr"|"ar"|"en"}` |
| POST | `/companies` | create + provision a company (becomes active) |
| GET/PATCH | `/companies/active` | company profile incl. NIF/NIS/RC/AI (`settings.manage` to edit) |

## Catalog
| Method | Path | Perm |
|---|---|---|
| GET/POST | `/products` (`?q= &categoryId= &lowStock=true &status=`) | `products.view` / `products.create` |
| GET/PATCH/DELETE | `/products/:id` (soft delete) | `products.*` |
| GET | `/products/lookup?barcode=` or `?q=&warehouseId=` | `pos.use` — exact barcode first, ≤12 rows |
| GET/POST, PATCH/DELETE | `/categories`, `/brands`, `/units` | `products.*` |

## Inventory
| Method | Path | Notes |
|---|---|---|
| GET | `/inventory?warehouseId=&q=&lowStock=true` | balances + stock value (cost-gated) |
| GET | `/inventory/movements?productId=&warehouseId=&type=` | the ledger |
| POST | `/inventory/adjustments` | `{warehouseId, productId, kind, quantity, unitCost?, notes?}` — kind: `adjustment_in/out, damage, loss, initial, count` (count = absolute target) |
| GET/POST | `/inventory/transfers` | draft transfer |
| POST | `/inventory/transfers/:id/send` / `…/receive` | stock out at source avg cost → stock in at same cost |

## Partners
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/customers` (`?q=&withDebt=true`), `/suppliers` | debt fields gated by `*.view_debt` |
| GET/PATCH/DELETE | `/customers/:id`, `/suppliers/:id` | detail includes stats, recent docs, top products; delete blocked while balance ≠ 0 (`HAS_BALANCE`) |

## Sales
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/sales` | POST `{saleType: invoice|pos|proforma, customerId?, warehouseId, registerSessionId?, items[{productId, quantity, unitPrice, discountPct?, taxRate?}], globalDiscount?, shipping?, dueDate?, payments[{paymentMethodId, amount}]}` — atomic: items + stock + payments + receivable; credit requires a customer and respects credit limit; discounts require `sales.discount` |
| GET | `/sales/:id` | items, payments, returns (cost/profit gated) |
| POST | `/sales/:id/return` | `{items[{saleItemId, quantity}], refund?{paymentMethodId, amount}}` — validates returnable qty, restocks at sold cost, credit note `AV…` |
| GET/POST | `/quotations`, POST `/quotations/:id/convert` | convert → invoice (stage skipping) |

## Purchases
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/purchases/orders`, GET `/purchases/orders/:id` | |
| GET/POST | `/purchases/receipts` | partial reception, over-reception guard, optional supplier invoice + payable, updates weighted-avg cost & last purchase price |
| GET | `/purchases/invoices?paymentStatus=&supplierId=` | |

## Payments & register
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/payments` | `{direction, partnerType, customerId|supplierId, paymentMethodId, amount, allocations[{targetType: sale|supplier_invoice, targetId, amount}]}` — allocation ≤ remaining due |
| GET/POST | `/payment-methods` | extensible (cash, cib, edahabia, transfer, cheque, credit…) |
| GET/POST | `/registers` | current + recent sessions / open (`REGISTER_ALREADY_OPEN`) |
| POST | `/registers/:id/close` | `{actualCash}` → expected (opening + cash in − cash out − cash expenses ± manual movements), difference |
| GET/POST | `/registers/:id/movements` | manual cash in/out |

## Offline POS sync
| Method | Path | Notes |
|---|---|---|
| GET | `/pos/catalog` | offline catalog snapshot: active products + barcodes + stock (`pos.use`) |
| POST | `/pos/sync` | `{deviceId, idempotencyKey, operation: "create_sale", payload}` — exactly-once replay via sync_queue; replays return the stored result (`duplicate: true`); business failures → 409 `SYNC_CONFLICT` |
| POST | `/pos/sync/conflict` | records a client-detected sync conflict for review |

## Deliveries & tracking
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/deliveries` (`?status=&active=true&courierId=`) | POST `{saleId?|customerId?|address?, courierId?, codAmount?, latitude?, longitude?, notes?}` — destination snapshotted; COD defaults to the sale's remaining due; couriers only see their own |
| GET | `/deliveries/:id` | detail (courier-restricted) |
| POST | `/deliveries/:id/assign` | `{courierId|null}` (`deliveries.assign`) |
| POST | `/deliveries/:id/status` | `{status, failureReason?, codCollected?, proofs?[{kind: photo|signature, data: dataURL ≤1MB}]}` — validated transitions; `delivered` settles COD via the payments engine; proofs stored append-only on delivered/failed; optional `qrToken` re-verified server-side and stamped as `qr_verified_at` (409 `INVALID_TRANSITION`/`QR_MISMATCH`, 400 `REASON_REQUIRED`) |
| POST | `/courier/ping` | `{latitude, longitude, accuracy?, heading?}` — own position only |
| GET | `/courier/positions` | latest position per courier + active delivery count (`deliveries.track`) |
| GET | `/courier/me` | courier worklist + today's delivered/COD stats |
| GET | `/deliveries/:id/proofs` | proof-of-delivery images (courier-restricted) |
| POST | `/deliveries/:id/verify-qr` | `{token}` — checks a scanned customer QR (`DAITEC:CUST:<uuid>`) against this delivery's customer (409 `QR_MISMATCH`, `NO_CUSTOMER`) |
| GET | `/map` | stores, warehouses, geolocated customers (`?withDebt=true`), active deliveries, courier directory (`map.view`) |

## Platform Super Admin (`/api/v1/admin/*` — operator only)
Guarded by `platform_admins` (grant via `scripts/make_platform_admin.sh <email>`); runs on the privileged pool — tenant RLS is untouched. All actions land in the immutable `platform_audit_logs`.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/overview` | platform metrics: companies, users, cross-tenant sales volume, top companies |
| GET | `/admin/companies?q=` | all companies with owner, members, products, 30-day revenue, last activity, suspension state |
| POST | `/admin/companies/:id/suspend` | `{reason}` — members get 403 `COMPANY_SUSPENDED` on every business API; no data deleted |
| POST | `/admin/companies/:id/activate` | lift a suspension |
| GET | `/admin/audit` | operator action trail (append-only) |

## Expenses, reports, audit, admin
| Method | Path | Notes |
|---|---|---|
| GET/POST, PATCH/DELETE | `/expenses`, `/expenses/:id` · GET/POST `/expense-categories` | |
| GET | `/reports/dashboard` | KPIs, 30-day trend, top products, payment mix, alerts |
| GET | `/reports/sales?from=&to=&groupBy=day|month|product|category|employee|method&format=csv` | CSV needs `reports.export` |
| GET | `/reports/inventory?kind=valuation|low_stock|out_of_stock|dead_stock` | |
| GET | `/reports/debts?side=customers|suppliers` · `/reports/expenses?from=&to=` | P&L estimate |
| GET | `/audit?entityType=&action=&userId=` | append-only log (`audit.view`) |
| GET | `/notifications?unread=true&limit=` | feed + unread count; runs a throttled sweep (low/out-of-stock, overdue customer invoices, supplier invoices due ≤7 days, failed deliveries) with unread-dedup |
| POST | `/notifications/read` | `{ids?[]}` or `{all: true}` — mark as read |
| GET | `/search?q=` | global: products, customers, suppliers, sales, POs (permission-aware) |
| GET/POST | `/members`, PATCH `/members/:id` | add employee account, change role/status (`users.manage`; owner locked) |
| GET/POST | `/roles` | roles + permission catalog |
| GET/POST, PATCH/DELETE | `/warehouses`, `/branches` | |
| GET/PUT | `/settings/receipt` | thermal receipt template: `{paperWidth: "58"|"80", headerText, footerText, showNif, showTaxDetail, showCashier, showCustomer, autoPrint}` (PUT needs `settings.manage`) |
