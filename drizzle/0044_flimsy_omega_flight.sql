CREATE TABLE `api_performance_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`route_key` text NOT NULL,
	`method` text NOT NULL,
	`status_code` integer NOT NULL,
	`outcome` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`db_duration_ms` integer DEFAULT 0 NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`cursor_used` integer DEFAULT false NOT NULL,
	`sampled_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `api_performance_samples_route_time_idx` ON `api_performance_samples` (`route_key`,`sampled_at`);--> statement-breakpoint
CREATE INDEX `api_performance_samples_time_idx` ON `api_performance_samples` (`sampled_at`);--> statement-breakpoint
CREATE INDEX `api_performance_samples_duration_idx` ON `api_performance_samples` (`duration_ms`,`sampled_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE tlink_product_search USING fts5(entity_id UNINDEXED, name, brand, model_number, supplier_name, category, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO tlink_product_search(entity_id, name, brand, model_number, supplier_name, category)
  SELECT p.id, p.name, p.brand, p.model_number, COALESCE(a.business_name, ''), p.category
  FROM supplier_products p LEFT JOIN trade_accounts a ON a.firebase_uid = p.firebase_uid;
--> statement-breakpoint
CREATE TRIGGER tlink_product_search_insert AFTER INSERT ON supplier_products BEGIN
  INSERT INTO tlink_product_search(entity_id, name, brand, model_number, supplier_name, category)
  VALUES (new.id, new.name, new.brand, new.model_number, COALESCE((SELECT business_name FROM trade_accounts WHERE firebase_uid = new.firebase_uid), ''), new.category);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_product_search_update AFTER UPDATE OF name, brand, model_number, category, firebase_uid ON supplier_products BEGIN
  DELETE FROM tlink_product_search WHERE entity_id = old.id;
  INSERT INTO tlink_product_search(entity_id, name, brand, model_number, supplier_name, category)
  VALUES (new.id, new.name, new.brand, new.model_number, COALESCE((SELECT business_name FROM trade_accounts WHERE firebase_uid = new.firebase_uid), ''), new.category);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_product_search_delete AFTER DELETE ON supplier_products BEGIN
  DELETE FROM tlink_product_search WHERE entity_id = old.id;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE tlink_account_search USING fts5(entity_id UNINDEXED, business_name, email, contact_name, postcode, state, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO tlink_account_search(entity_id, business_name, email, contact_name, postcode, state)
  SELECT firebase_uid, business_name, email, contact_name, postcode, address_state FROM trade_accounts;
--> statement-breakpoint
CREATE TRIGGER tlink_account_search_insert AFTER INSERT ON trade_accounts BEGIN
  INSERT INTO tlink_account_search(entity_id, business_name, email, contact_name, postcode, state)
  VALUES (new.firebase_uid, new.business_name, new.email, new.contact_name, new.postcode, new.address_state);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_account_search_update AFTER UPDATE OF business_name, email, contact_name, postcode, address_state ON trade_accounts BEGIN
  DELETE FROM tlink_account_search WHERE entity_id = old.firebase_uid;
  INSERT INTO tlink_account_search(entity_id, business_name, email, contact_name, postcode, state)
  VALUES (new.firebase_uid, new.business_name, new.email, new.contact_name, new.postcode, new.address_state);
  DELETE FROM tlink_product_search WHERE entity_id IN (SELECT id FROM supplier_products WHERE firebase_uid = new.firebase_uid);
  INSERT INTO tlink_product_search(entity_id, name, brand, model_number, supplier_name, category)
    SELECT id, name, brand, model_number, new.business_name, category FROM supplier_products WHERE firebase_uid = new.firebase_uid;
END;
--> statement-breakpoint
CREATE TRIGGER tlink_account_search_delete AFTER DELETE ON trade_accounts BEGIN
  DELETE FROM tlink_account_search WHERE entity_id = old.firebase_uid;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE tlink_customer_search USING fts5(entity_id UNINDEXED, display_name, email, postcode, state, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO tlink_customer_search(entity_id, display_name, email, postcode, state)
  SELECT firebase_uid, display_name, email, postcode, address_state FROM customer_accounts;
--> statement-breakpoint
CREATE TRIGGER tlink_customer_search_insert AFTER INSERT ON customer_accounts BEGIN
  INSERT INTO tlink_customer_search(entity_id, display_name, email, postcode, state)
  VALUES (new.firebase_uid, new.display_name, new.email, new.postcode, new.address_state);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_customer_search_update AFTER UPDATE OF display_name, email, postcode, address_state ON customer_accounts BEGIN
  DELETE FROM tlink_customer_search WHERE entity_id = old.firebase_uid;
  INSERT INTO tlink_customer_search(entity_id, display_name, email, postcode, state)
  VALUES (new.firebase_uid, new.display_name, new.email, new.postcode, new.address_state);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_customer_search_delete AFTER DELETE ON customer_accounts BEGIN
  DELETE FROM tlink_customer_search WHERE entity_id = old.firebase_uid;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE tlink_opportunity_search USING fts5(entity_id UNINDEXED, title, summary, project_type, postcode, state, services, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO tlink_opportunity_search(entity_id, title, summary, project_type, postcode, state, services)
  SELECT id, title, summary, project_type, postcode, state, service_categories FROM trade_opportunities;
--> statement-breakpoint
CREATE TRIGGER tlink_opportunity_search_insert AFTER INSERT ON trade_opportunities BEGIN
  INSERT INTO tlink_opportunity_search(entity_id, title, summary, project_type, postcode, state, services)
  VALUES (new.id, new.title, new.summary, new.project_type, new.postcode, new.state, new.service_categories);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_opportunity_search_update AFTER UPDATE OF title, summary, project_type, postcode, state, service_categories ON trade_opportunities BEGIN
  DELETE FROM tlink_opportunity_search WHERE entity_id = old.id;
  INSERT INTO tlink_opportunity_search(entity_id, title, summary, project_type, postcode, state, services)
  VALUES (new.id, new.title, new.summary, new.project_type, new.postcode, new.state, new.service_categories);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_opportunity_search_delete AFTER DELETE ON trade_opportunities BEGIN
  DELETE FROM tlink_opportunity_search WHERE entity_id = old.id;
END;
--> statement-breakpoint
CREATE VIRTUAL TABLE tlink_crm_customer_search USING fts5(entity_id UNINDEXED, owner_uid UNINDEXED, customer_number, first_name, last_name, business_name, email, phone, street, suburb, postcode, state, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
INSERT INTO tlink_crm_customer_search(entity_id, owner_uid, customer_number, first_name, last_name, business_name, email, phone, street, suburb, postcode, state)
  SELECT id, firebase_uid, customer_number, first_name, last_name, business_name, email, phone,
    TRIM(address_line_1 || ' ' || address_line_2), suburb, postcode, address_state FROM trade_crm_customers;
--> statement-breakpoint
CREATE TRIGGER tlink_crm_customer_search_insert AFTER INSERT ON trade_crm_customers BEGIN
  INSERT INTO tlink_crm_customer_search(entity_id, owner_uid, customer_number, first_name, last_name, business_name, email, phone, street, suburb, postcode, state)
  VALUES (new.id, new.firebase_uid, new.customer_number, new.first_name, new.last_name, new.business_name, new.email, new.phone,
    TRIM(new.address_line_1 || ' ' || new.address_line_2), new.suburb, new.postcode, new.address_state);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_crm_customer_search_update AFTER UPDATE OF customer_number, first_name, last_name, business_name, email, phone, address_line_1, address_line_2, suburb, postcode, address_state ON trade_crm_customers BEGIN
  DELETE FROM tlink_crm_customer_search WHERE entity_id = old.id;
  INSERT INTO tlink_crm_customer_search(entity_id, owner_uid, customer_number, first_name, last_name, business_name, email, phone, street, suburb, postcode, state)
  VALUES (new.id, new.firebase_uid, new.customer_number, new.first_name, new.last_name, new.business_name, new.email, new.phone,
    TRIM(new.address_line_1 || ' ' || new.address_line_2), new.suburb, new.postcode, new.address_state);
END;
--> statement-breakpoint
CREATE TRIGGER tlink_crm_customer_search_delete AFTER DELETE ON trade_crm_customers BEGIN
  DELETE FROM tlink_crm_customer_search WHERE entity_id = old.id;
END;
