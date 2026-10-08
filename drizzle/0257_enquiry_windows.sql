ALTER TABLE trade_opportunities ADD COLUMN quote_window_value INTEGER NOT NULL DEFAULT 30 CHECK(quote_window_value BETWEEN 1 AND 365);
ALTER TABLE trade_opportunities ADD COLUMN quote_window_unit TEXT NOT NULL DEFAULT 'days' CHECK(quote_window_unit IN ('days','months'));
ALTER TABLE trade_opportunities ADD COLUMN requested_completion TEXT NOT NULL DEFAULT 'flexible' CHECK(requested_completion IN ('flexible','one-month','three-months','six-months','date'));
ALTER TABLE trade_opportunities ADD COLUMN requested_work_by TEXT NOT NULL DEFAULT '';
ALTER TABLE trade_opportunities ADD COLUMN customer_sector TEXT NOT NULL DEFAULT 'unclassified' CHECK(customer_sector IN ('residential','business','unclassified'));
