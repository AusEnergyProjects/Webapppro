CREATE TABLE trade_network_members (
  owner_uid TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  consent_version TEXT NOT NULL DEFAULT '',
  consent_at TEXT NOT NULL DEFAULT '',
  updated_by_uid TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE trade_network_posts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('work','available')),
  title TEXT NOT NULL, trade TEXT NOT NULL, suburb TEXT NOT NULL,
  postcode TEXT NOT NULL, state TEXT NOT NULL, details TEXT NOT NULL,
  rate_cents INTEGER CHECK(rate_cents IS NULL OR rate_cents BETWEEN 0 AND 100000000),
  rate_unit TEXT NOT NULL CHECK(rate_unit IN ('hour','day','job')),
  starts_on TEXT NOT NULL DEFAULT '', ends_on TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  expires_at TEXT NOT NULL,
  last_request_hash TEXT NOT NULL,
  created_by_uid TEXT NOT NULL, updated_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX trade_network_posts_feed_idx ON trade_network_posts(status,expires_at,updated_at,id);
CREATE INDEX trade_network_posts_owner_idx ON trade_network_posts(owner_uid,updated_at,id);
CREATE TABLE trade_network_enquiries (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES trade_network_posts(id),
  sender_owner_uid TEXT NOT NULL, recipient_owner_uid TEXT NOT NULL,
  post_title TEXT NOT NULL, post_kind TEXT NOT NULL CHECK(post_kind IN ('work','available')),
  sender_business_name TEXT NOT NULL, recipient_business_name TEXT NOT NULL,
  message TEXT NOT NULL, sender_contact_json TEXT NOT NULL CHECK(json_valid(sender_contact_json)),
  recipient_contact_json TEXT NOT NULL DEFAULT '' CHECK(recipient_contact_json = '' OR json_valid(recipient_contact_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','closed')),
  revision INTEGER NOT NULL CHECK(revision > 0), last_request_hash TEXT NOT NULL,
  created_by_uid TEXT NOT NULL, updated_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK(sender_owner_uid <> recipient_owner_uid)
);
CREATE UNIQUE INDEX trade_network_enquiries_post_sender_idx ON trade_network_enquiries(post_id,sender_owner_uid);
CREATE INDEX trade_network_enquiries_sender_idx ON trade_network_enquiries(sender_owner_uid,updated_at,id);
CREATE INDEX trade_network_enquiries_recipient_idx ON trade_network_enquiries(recipient_owner_uid,updated_at,id);
