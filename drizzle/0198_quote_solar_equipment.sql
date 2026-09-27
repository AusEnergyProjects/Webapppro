-- Equipment is saved with each draft and frozen inside its issued document snapshot.
ALTER TABLE trade_crm_quote_versions ADD COLUMN equipment_json TEXT NOT NULL DEFAULT '';
ALTER TABLE trade_crm_quote_versions ADD COLUMN roof_design_id TEXT NOT NULL DEFAULT '';
