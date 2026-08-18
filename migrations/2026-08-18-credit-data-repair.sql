-- LEGACY CREDIT DATA REPAIR — READ/VERIFY FIRST
-- Run only after taking a fresh SQLite/Turso backup.
-- This migration is intentionally NOT auto-run by the application.
-- It removes only credit_payment rows whose method is explicitly 'آجل', because
-- 'آجل' is a debt classification, not a settlement method, then rebuilds paid
-- totals from the remaining real credit payments.

BEGIN;

-- 1) Snapshot candidates into a temporary table for audit before mutation.
DROP TABLE IF EXISTS _credit_repair_candidates;
CREATE TEMP TABLE _credit_repair_candidates AS
SELECT
  o.id AS order_id,
  o.total,
  o.paid AS orders_paid_before,
  o.payment_method,
  cl.id AS ledger_id,
  cl.paid AS ledger_paid_before,
  COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.ledger_id = cl.id AND COALESCE(cp.method,'') <> 'آجل'), 0) AS real_payments,
  COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.ledger_id = cl.id AND cp.method = 'آجل'), 0) AS invalid_credit_method_amount
FROM orders o
JOIN credit_ledger cl ON cl.order_id = o.id
WHERE o.payment_method = 'آجل'
   OR EXISTS (SELECT 1 FROM credit_payments cp WHERE cp.ledger_id = cl.id AND cp.method = 'آجل');

-- 2) Remove only the logically invalid 'آجل' payment rows.
DELETE FROM credit_payments
WHERE method = 'آجل';

-- 3) Rebuild ledger paid/status from actual remaining payment rows.
UPDATE credit_ledger
SET paid = COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.ledger_id = credit_ledger.id), 0),
    status = CASE
      WHEN COALESCE((SELECT SUM(cp.amount) FROM credit_payments cp WHERE cp.ledger_id = credit_ledger.id), 0) >= total THEN 'settled'
      ELSE 'open'
    END;

-- 4) For credit orders, orders.paid must reflect real settlement only.
UPDATE orders
SET paid = MIN(
  total,
  COALESCE((
    SELECT SUM(cp.amount)
    FROM credit_payments cp
    JOIN credit_ledger cl ON cl.id = cp.ledger_id
    WHERE cl.order_id = orders.id
  ), 0)
)
WHERE payment_method = 'آجل';

-- 5) Verification: these must return zero before COMMIT.
--    A) credit payments incorrectly labelled as debt
SELECT COUNT(*) AS remaining_invalid_credit_payments
FROM credit_payments
WHERE method = 'آجل';

--    B) credit orders with paid above total
SELECT COUNT(*) AS credit_orders_overpaid
FROM orders
WHERE payment_method = 'آجل' AND paid > total;

--    C) ledger paid above total
SELECT COUNT(*) AS ledger_overpaid
FROM credit_ledger
WHERE paid > total;

COMMIT;

-- Post-migration audit queries:
-- SELECT * FROM _credit_repair_candidates ORDER BY order_id;
-- SELECT id,total,paid,payment_method FROM orders WHERE payment_method='آجل' ORDER BY id;
-- SELECT id,order_id,total,paid,status FROM credit_ledger ORDER BY id;
-- SELECT id,ledger_id,amount,method FROM credit_payments ORDER BY id;
