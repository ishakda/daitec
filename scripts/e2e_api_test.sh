#!/usr/bin/env bash
# End-to-end API test: purchase → stock → POS sale → credit sale →
# payment → return → register close → reports. Fails on any error.
set -euo pipefail
B=http://localhost:3000/api/v1
CJ=/tmp/e2e_cookies.txt
rm -f $CJ

j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)"; }

step() { echo; echo "== $1"; }

step "login"
curl -sf -c $CJ -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"karim@demo.dz","password":"password123"}' > /dev/null
echo OK

step "get default warehouse + payment methods"
WH=$(curl -sf -b $CJ $B/warehouses | j "['data'][0]['id']")
CASH=$(curl -sf -b $CJ $B/payment-methods | python3 -c "import sys,json; d=json.load(sys.stdin); print([m['id'] for m in d['data'] if m['code']=='cash'][0])")
echo "warehouse=$WH cash=$CASH"

step "create category + product with barcode"
CAT=$(curl -sf -b $CJ -X POST $B/categories -H 'content-type: application/json' \
  -d '{"name":"Smartphones"}' | j "['id']")
PROD=$(curl -sf -b $CJ -X POST $B/products -H 'content-type: application/json' \
  -d "{\"sku\":\"SAM-A15\",\"name\":\"Samsung Galaxy A15\",\"categoryId\":\"$CAT\",\"sellingPrice\":32000,\"taxRate\":19,\"minimumStock\":5,\"barcodes\":[\"6191234567890\"]}" | j "['id']")
echo "product=$PROD"

step "create supplier + purchase order"
SUP=$(curl -sf -b $CJ -X POST $B/suppliers -H 'content-type: application/json' \
  -d '{"name":"SARL TechImport","city":"Alger","nif":"099916111222333"}' | j "['id']")
PO=$(curl -sf -b $CJ -X POST $B/purchases/orders -H 'content-type: application/json' \
  -d "{\"supplierId\":\"$SUP\",\"warehouseId\":\"$WH\",\"items\":[{\"productId\":\"$PROD\",\"quantity\":20,\"unitPrice\":25000,\"taxRate\":19}]}")
POID=$(echo "$PO" | j "['purchaseOrderId']")
echo "po=$(echo "$PO" | j "['number']") total=$(echo "$PO" | j "['totals']['total']")"

step "receive goods (creates supplier invoice + stock)"
POITEM=$(curl -sf -b $CJ $B/purchases/orders/$POID | j "['items'][0]['id']")
GR=$(curl -sf -b $CJ -X POST $B/purchases/receipts -H 'content-type: application/json' \
  -d "{\"purchaseOrderId\":\"$POID\",\"supplierId\":\"$SUP\",\"warehouseId\":\"$WH\",\"items\":[{\"purchaseOrderItemId\":\"$POITEM\",\"productId\":\"$PROD\",\"quantity\":20,\"unitCost\":25000}],\"createSupplierInvoice\":true,\"dueDate\":\"2026-09-15\"}")
echo "receipt=$(echo "$GR" | j "['number']") value=$(echo "$GR" | j "['totalValue']") si=$(echo "$GR" | j "['supplierInvoice']['number']")"

step "barcode lookup (POS)"
curl -sf -b $CJ "$B/products/lookup?barcode=6191234567890" | j "['data'][0]['stock']"

step "open register"
REG=$(curl -sf -b $CJ -X POST $B/registers -H 'content-type: application/json' \
  -d '{"openingCash":10000}' | j "['sessionId']")
echo "register=$REG"

step "POS cash sale: 2 units @ 32000 HT + 19% VAT"
SALE1=$(curl -sf -b $CJ -X POST $B/sales -H 'content-type: application/json' \
  -d "{\"saleType\":\"pos\",\"warehouseId\":\"$WH\",\"registerSessionId\":\"$REG\",\"items\":[{\"productId\":\"$PROD\",\"quantity\":2,\"unitPrice\":32000,\"taxRate\":19}],\"payments\":[{\"paymentMethodId\":\"$CASH\",\"amount\":76160}]}")
echo "sale=$(echo "$SALE1" | j "['number']") total=$(echo "$SALE1" | j "['totals']['total']") cost=$(echo "$SALE1" | j "['totalCost']")"

step "create customer + credit sale with partial payment"
CUST=$(curl -sf -b $CJ -X POST $B/customers -H 'content-type: application/json' \
  -d '{"name":"Boutique El Amel","phone":"0555123456","creditLimit":500000}' | j "['id']")
SALE2=$(curl -sf -b $CJ -X POST $B/sales -H 'content-type: application/json' \
  -d "{\"saleType\":\"invoice\",\"customerId\":\"$CUST\",\"warehouseId\":\"$WH\",\"dueDate\":\"2026-08-25\",\"items\":[{\"productId\":\"$PROD\",\"quantity\":5,\"unitPrice\":31000,\"taxRate\":19}],\"payments\":[{\"paymentMethodId\":\"$CASH\",\"amount\":100000}]}")
SALE2ID=$(echo "$SALE2" | j "['saleId']")
echo "invoice=$(echo "$SALE2" | j "['number']") total=$(echo "$SALE2" | j "['totals']['total']") paid=100000"

step "customer balance after credit sale (expect 84450 = 184450-100000)"
curl -sf -b $CJ $B/customers/$CUST | j "['balance']"

step "customer settles 50000 allocated to invoice"
PAY=$(curl -sf -b $CJ -X POST $B/payments -H 'content-type: application/json' \
  -d "{\"direction\":\"in\",\"partnerType\":\"customer\",\"customerId\":\"$CUST\",\"paymentMethodId\":\"$CASH\",\"amount\":50000,\"allocations\":[{\"targetType\":\"sale\",\"targetId\":\"$SALE2ID\",\"amount\":50000}]}")
echo "payment=$(echo "$PAY" | j "['number']")"
echo "balance now: $(curl -sf -b $CJ $B/customers/$CUST | j "['balance']") (expect 34450)"

step "overpayment must be rejected"
HTTP=$(curl -s -o /tmp/over.json -w "%{http_code}" -b $CJ -X POST $B/payments -H 'content-type: application/json' \
  -d "{\"direction\":\"in\",\"partnerType\":\"customer\",\"customerId\":\"$CUST\",\"paymentMethodId\":\"$CASH\",\"amount\":999999,\"allocations\":[{\"targetType\":\"sale\",\"targetId\":\"$SALE2ID\",\"amount\":999999}]}")
echo "status=$HTTP code=$(cat /tmp/over.json | j "['error']['code']") (expect 409 OVERPAYMENT)"

step "oversell must be rejected (stock is 13)"
HTTP=$(curl -s -o /tmp/oversell.json -w "%{http_code}" -b $CJ -X POST $B/sales -H 'content-type: application/json' \
  -d "{\"saleType\":\"pos\",\"warehouseId\":\"$WH\",\"registerSessionId\":\"$REG\",\"items\":[{\"productId\":\"$PROD\",\"quantity\":50,\"unitPrice\":32000}],\"payments\":[{\"paymentMethodId\":\"$CASH\",\"amount\":1600000}]}")
echo "status=$HTTP code=$(cat /tmp/oversell.json | j "['error']['code']") (expect 409 INSUFFICIENT_STOCK)"

step "return 1 unit from POS sale with cash refund"
SALE1ID=$(echo "$SALE1" | j "['saleId']")
ITEM1=$(curl -sf -b $CJ $B/sales/$SALE1ID | j "['items'][0]['id']")
RET=$(curl -sf -b $CJ -X POST $B/sales/$SALE1ID/return -H 'content-type: application/json' \
  -d "{\"items\":[{\"saleItemId\":\"$ITEM1\",\"quantity\":1}],\"refund\":{\"paymentMethodId\":\"$CASH\",\"amount\":38080},\"registerSessionId\":\"$REG\"}")
echo "return=$(echo "$RET" | j "['number']") total=$(echo "$RET" | j "['total']") refunded=$(echo "$RET" | j "['refunded']")"

step "stock after all operations (expect 20-2-5+1=14)"
curl -sf -b $CJ "$B/products/lookup?barcode=6191234567890" | j "['data'][0]['stock']"

step "pay supplier 200000 against invoice"
SI=$(curl -sf -b $CJ "$B/purchases/invoices" | j "['data'][0]['id']")
curl -sf -b $CJ -X POST $B/payments -H 'content-type: application/json' \
  -d "{\"direction\":\"out\",\"partnerType\":\"supplier\",\"supplierId\":\"$SUP\",\"paymentMethodId\":\"$CASH\",\"amount\":200000,\"allocations\":[{\"targetType\":\"supplier_invoice\",\"targetId\":\"$SI\",\"amount\":200000}]}" | j "['number']"
echo "supplier balance: $(curl -sf -b $CJ $B/suppliers/$SUP | j "['balance']") (expect 300000)"

step "close register"
CLOSE=$(curl -sf -b $CJ -X POST $B/registers/$REG/close -H 'content-type: application/json' \
  -d '{"actualCash":0}')
echo "expected=$(echo "$CLOSE" | j "['expected']") actual=$(echo "$CLOSE" | j "['actual']") diff=$(echo "$CLOSE" | j "['difference']")"

step "dashboard KPIs"
curl -sf -b $CJ $B/reports/dashboard | python3 -c "import sys,json; d=json.load(sys.stdin); print('today:',d['today']); print('receivables:',d['receivables']['total']); print('alerts:',d['alerts'])"

step "sales report by product"
curl -sf -b $CJ "$B/reports/sales?groupBy=product" | python3 -c "import sys,json; [print(r) for r in json.load(sys.stdin)['data']]"

step "audit log entries"
curl -sf -b $CJ "$B/audit?limit=100" | python3 -c "import sys,json; [print(r['action'],r['entity_type'],r['entity_label']) for r in json.load(sys.stdin)['data'][:12]]"

echo; echo "E2E TEST COMPLETE"
