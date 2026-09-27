-- A draft can retain a roof design before its immutable issue snapshot is created.
-- Private R2 references are copied into issued snapshots and never supplied by clients.
ALTER TABLE trade_crm_quote_versions ADD COLUMN roof_image_json TEXT NOT NULL DEFAULT '';
