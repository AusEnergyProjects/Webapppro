CREATE TABLE trade_map_location_cache (
  owner_uid text NOT NULL,
  address_key text NOT NULL,
  address text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','located','unlocated','error')),
  lat real,
  lng real,
  approximate integer NOT NULL DEFAULT 0 CHECK(approximate IN (0,1)),
  reason text NOT NULL DEFAULT '',
  checked_at text NOT NULL DEFAULT '',
  expires_at text NOT NULL DEFAULT '',
  lease_token text NOT NULL DEFAULT '',
  lease_expires_at text NOT NULL DEFAULT '',
  retry_after text NOT NULL DEFAULT '',
  PRIMARY KEY(owner_uid,address_key),
  CHECK(length(address_key) BETWEEN 1 AND 1000),
  CHECK(length(address) BETWEEN 1 AND 1000),
  CHECK((status='located' AND lat BETWEEN -55 AND -9 AND lng BETWEEN 96 AND 169 AND lat IS NOT NULL AND lng IS NOT NULL AND expires_at<>'')
    OR (status<>'located' AND lat IS NULL AND lng IS NULL))
);
--> statement-breakpoint
CREATE INDEX trade_map_location_cache_expiry_idx ON trade_map_location_cache(expires_at) WHERE expires_at<>'';
--> statement-breakpoint
CREATE INDEX trade_map_location_cache_lease_idx ON trade_map_location_cache(owner_uid,lease_token) WHERE lease_token<>'';
--> statement-breakpoint
CREATE INDEX trade_map_location_cache_backoff_idx ON trade_map_location_cache(owner_uid,retry_after) WHERE status='error';
