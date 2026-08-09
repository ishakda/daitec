#!/usr/bin/env bash
# Grant platform super-admin to a user by email.
# Usage: ./scripts/make_platform_admin.sh someone@example.com
set -euo pipefail
EMAIL="${1:?usage: make_platform_admin.sh <email>}"
psql -h /tmp -U postgres -d sahla -v ON_ERROR_STOP=1 <<SQL
insert into platform_admins (user_id, note)
select id, 'granted via script' from users where email = lower('$EMAIL')
on conflict (user_id) do nothing;
SQL
echo "platform admin granted to $EMAIL"
