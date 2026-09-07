ALTER TABLE trade_form_templates ADD COLUMN scope_owner_uid text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX trade_form_templates_scope_idx ON trade_form_templates(scope_owner_uid, template_key, version);
