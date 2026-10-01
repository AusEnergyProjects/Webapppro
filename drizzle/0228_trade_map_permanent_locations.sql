CREATE TABLE trade_map_location_cache_next (
  owner_uid text NOT NULL,
  address_key text NOT NULL,
  address text NOT NULL,
  provider text NOT NULL DEFAULT 'gnaf' CHECK(provider IN ('google','gnaf')),
  source_version text NOT NULL DEFAULT '',
  source_id text NOT NULL DEFAULT '',
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
  CHECK((provider='google' AND source_version='' AND source_id='') OR
    (provider='gnaf' AND expires_at='' AND (status NOT IN ('located','unlocated') OR length(source_version) BETWEEN 1 AND 180))),
  CHECK((status='located' AND lat BETWEEN -55 AND -9 AND lng BETWEEN 96 AND 169 AND lat IS NOT NULL AND lng IS NOT NULL
      AND ((provider='google' AND expires_at<>'') OR (provider='gnaf' AND length(source_id) BETWEEN 1 AND 180)))
    OR (status<>'located' AND lat IS NULL AND lng IS NULL))
);
--> statement-breakpoint
INSERT INTO trade_map_location_cache_next
  (owner_uid,address_key,address,provider,status,lat,lng,approximate,reason,checked_at,expires_at,lease_token,lease_expires_at,retry_after)
  SELECT owner_uid,address_key,address,'google',status,lat,lng,approximate,reason,checked_at,expires_at,lease_token,lease_expires_at,retry_after
  FROM trade_map_location_cache;
--> statement-breakpoint
DROP TABLE trade_map_location_cache;
--> statement-breakpoint
ALTER TABLE trade_map_location_cache_next RENAME TO trade_map_location_cache;
--> statement-breakpoint
CREATE INDEX trade_map_location_cache_expiry_idx ON trade_map_location_cache(expires_at) WHERE provider='google' AND expires_at<>'';
--> statement-breakpoint
CREATE INDEX trade_map_location_cache_lease_idx ON trade_map_location_cache(owner_uid,lease_token) WHERE lease_token<>'';
