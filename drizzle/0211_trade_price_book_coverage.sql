ALTER TABLE trade_price_book_items ADD COLUMN coverage_m2_per_unit_milli INTEGER
  CHECK (coverage_m2_per_unit_milli IS NULL OR (typeof(coverage_m2_per_unit_milli) = 'integer' AND coverage_m2_per_unit_milli BETWEEN 1 AND 999999000));
