-- Internal component quantities and costs freeze with the issued quote execution snapshot.
-- Empty marks legacy issued quotes whose component stock was never captured.
ALTER TABLE trade_crm_quote_execution_snapshots ADD COLUMN solar_stock_json TEXT NOT NULL DEFAULT '' CHECK (solar_stock_json = '' OR json_valid(solar_stock_json));
