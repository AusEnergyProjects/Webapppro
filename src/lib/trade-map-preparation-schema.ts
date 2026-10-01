/** Prepared statements preserve trigger bodies on Sites migration runners. */
export const TRADE_MAP_PREPARATION_SCHEMA_GUARDS = [
  {
    "name": "trade_crm_customers_map_insert",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crm_customers_map_insert\nAFTER INSERT ON trade_crm_customers\n\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_crm_customers_map_update",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crm_customers_map_update\nAFTER UPDATE OF address_line_1,address_line_2,suburb,address_state,postcode,record_status ON trade_crm_customers\nWHEN NEW.address_line_1 IS NOT OLD.address_line_1 OR NEW.address_line_2 IS NOT OLD.address_line_2 OR NEW.suburb IS NOT OLD.suburb OR NEW.address_state IS NOT OLD.address_state OR NEW.postcode IS NOT OLD.postcode OR NEW.record_status IS NOT OLD.record_status\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_crm_service_sites_map_insert",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crm_service_sites_map_insert\nAFTER INSERT ON trade_crm_service_sites\n\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_crm_service_sites_map_update",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crm_service_sites_map_update\nAFTER UPDATE OF address_line_1,address_line_2,suburb,address_state,postcode,record_status ON trade_crm_service_sites\nWHEN NEW.address_line_1 IS NOT OLD.address_line_1 OR NEW.address_line_2 IS NOT OLD.address_line_2 OR NEW.suburb IS NOT OLD.suburb OR NEW.address_state IS NOT OLD.address_state OR NEW.postcode IS NOT OLD.postcode OR NEW.record_status IS NOT OLD.record_status\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_crm_job_details_map_insert",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crm_job_details_map_insert\nAFTER INSERT ON trade_crm_job_details\n\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_crm_job_details_map_update",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_crm_job_details_map_update\nAFTER UPDATE OF service_site_id,customer_source,work_order_id ON trade_crm_job_details\nWHEN NEW.service_site_id IS NOT OLD.service_site_id OR NEW.customer_source IS NOT OLD.customer_source OR NEW.work_order_id IS NOT OLD.work_order_id\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_work_orders_map_insert",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_work_orders_map_insert\nAFTER INSERT ON trade_work_orders\n\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  },
  {
    "name": "trade_work_orders_map_update",
    "sql": "CREATE TRIGGER IF NOT EXISTS trade_work_orders_map_update\nAFTER UPDATE OF record_status,source_type,partner_type ON trade_work_orders\nWHEN NEW.record_status IS NOT OLD.record_status OR NEW.source_type IS NOT OLD.source_type OR NEW.partner_type IS NOT OLD.partner_type\nBEGIN\n  INSERT INTO trade_map_preparation(owner_uid,updated_at) VALUES(NEW.firebase_uid,strftime('%Y-%m-%dT%H:%M:%fZ','now'))\n    ON CONFLICT(owner_uid) DO UPDATE SET requested_revision=trade_map_preparation.requested_revision+1,\n      updated_at=excluded.updated_at;\nEND;"
  }
] as const;
