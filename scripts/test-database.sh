#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?Set DATABASE_URL to an empty disposable PostgreSQL database}"

apply() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
verify() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }

apply database/001_initial_schema.sql
apply database/002_storefront_discovery.sql
verify database/tests/002_storefront_discovery_test.sql
apply database/003_cart_service.sql
verify database/tests/003_cart_service_test.sql
apply database/004_checkout_orders.sql
verify database/tests/004_checkout_orders_test.sql
apply database/005_notification_outbox.sql
verify database/tests/005_notification_outbox_test.sql
apply database/006_admin_governance.sql
verify database/tests/006_admin_governance_test.sql
apply database/007_content_governance.sql
verify database/tests/007_content_governance_test.sql
apply database/008_customer_order_access.sql
verify database/tests/008_customer_order_access_test.sql
apply database/009_application_roles.sql
verify database/tests/009_application_roles_test.sql
apply database/010_delivery_discovery.sql
apply database/011_order_governance.sql
verify database/tests/011_order_governance_test.sql
apply database/012_shipment_governance.sql
verify database/tests/012_shipment_governance_test.sql

echo "Database migrations and staged regression tests passed."
