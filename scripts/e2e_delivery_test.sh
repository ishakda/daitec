#!/usr/bin/env bash
# Delivery module e2e: unpaid invoice → delivery (COD auto = due) →
# livreur status flow → COD settled through payments → guards.
# Requires: dev server + demo seed + geo seed (livreur@sahla.dz).
set -euo pipefail
B=http://localhost:3000/api/v1
OJ=/tmp/e2e_owner.txt; LJ=/tmp/e2e_livreur.txt
rm -f $OJ $LJ
j() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
step() { echo; echo "== $1"; }

step "login owner + livreur"
curl -sf -c $OJ -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"demo@sahla.dz","password":"demo12345"}' > /dev/null
curl -sf -c $LJ -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"livreur@sahla.dz","password":"livreur123"}' > /dev/null
LIVREUR=$(curl -sf -b $OJ $B/members | python3 -c "import sys,json; print([m['user_id'] for m in json.load(sys.stdin)['data'] if m['email']=='livreur@sahla.dz'][0])")
echo OK

step "pick an open invoice"
SALE=$(curl -sf -b $OJ "$B/sales?type=invoice&paymentStatus=unpaid&limit=1" | j "['data'][0]['id']" 2>/dev/null \
  || curl -sf -b $OJ "$B/sales?type=invoice&paymentStatus=partial&limit=1" | j "['data'][0]['id']")
DUE=$(curl -sf -b $OJ "$B/sales/$SALE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(round(float(d['total'])-float(d['paid_amount']),2))")
echo "sale=$SALE due=$DUE"

step "create delivery from sale (COD defaults to due) + assign livreur"
D=$(curl -sf -b $OJ -X POST $B/deliveries -H 'content-type: application/json' \
  -d "{\"saleId\":\"$SALE\",\"courierId\":\"$LIVREUR\"}")
DID=$(echo "$D" | j "['id']")
echo "delivery=$(echo "$D" | j "['number']")"
COD=$(curl -sf -b $OJ $B/deliveries/$DID | j "['cod_amount']")
echo "cod=$COD (expect $DUE)"

step "livreur cannot skip to delivered from assigned via invalid path"
HTTP=$(curl -s -o /tmp/tr.json -w "%{http_code}" -b $LJ -X POST $B/deliveries/$DID/status \
  -H 'content-type: application/json' -d '{"status":"delivered"}')
echo "assigned→delivered: $HTTP $(cat /tmp/tr.json | j "['error']['code']") (expect 409 INVALID_TRANSITION)"

step "livreur pings position + drives the flow"
curl -sf -b $LJ -X POST $B/courier/ping -H 'content-type: application/json' \
  -d '{"latitude":36.75,"longitude":3.05,"accuracy":10}' > /dev/null
curl -sf -b $LJ -X POST $B/deliveries/$DID/status -H 'content-type: application/json' -d '{"status":"picked_up"}' > /dev/null
curl -sf -b $LJ -X POST $B/deliveries/$DID/status -H 'content-type: application/json' -d '{"status":"out_for_delivery"}' > /dev/null
R=$(curl -sf -b $LJ -X POST $B/deliveries/$DID/status -H 'content-type: application/json' -d '{"status":"delivered"}')
echo "delivered, codPaymentId=$(echo "$R" | j "['codPaymentId']")"

step "sale is settled by COD"
curl -sf -b $OJ "$B/sales/$SALE" | python3 -c "import sys,json; d=json.load(sys.stdin); print('paid:',d['paid_amount'],'status:',d['payment_status'],'(expect paid)')"

step "courier appears in live positions"
curl -sf -b $OJ $B/courier/positions | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(len(d),'courier(s):',d[0]['courier_name'])"

echo; echo "DELIVERY E2E COMPLETE"
