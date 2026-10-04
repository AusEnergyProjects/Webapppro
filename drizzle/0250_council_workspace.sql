CREATE TABLE council_organisations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL UNIQUE CHECK(length(slug) BETWEEN 3 AND 64),
  state TEXT NOT NULL CHECK(state IN ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, state)
);
--> statement-breakpoint
CREATE TABLE council_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  council_id TEXT NOT NULL REFERENCES council_organisations(id),
  firebase_uid TEXT,
  email TEXT NOT NULL CHECK(email = lower(trim(email))),
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner','editor','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  invited_by_uid TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(council_id, email),
  UNIQUE(council_id, firebase_uid)
);
--> statement-breakpoint
CREATE INDEX council_memberships_identity_idx ON council_memberships(firebase_uid, status);
--> statement-breakpoint
CREATE INDEX council_memberships_email_idx ON council_memberships(email, status);
--> statement-breakpoint
CREATE TABLE council_postcodes (
  council_id TEXT NOT NULL,
  state TEXT NOT NULL,
  postcode TEXT NOT NULL CHECK(length(postcode) = 4 AND postcode NOT GLOB '*[^0-9]*'),
  approved_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(council_id, state, postcode),
  FOREIGN KEY(council_id, state) REFERENCES council_organisations(id, state)
);
--> statement-breakpoint
CREATE TABLE council_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  council_id TEXT NOT NULL REFERENCES council_organisations(id),
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 2 AND 120),
  kind TEXT NOT NULL CHECK(kind IN ('campaign','session')),
  audience TEXT NOT NULL CHECK(audience IN ('everyone','households','businesses','trades')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  starts_at TEXT,
  location TEXT,
  meeting_url TEXT,
  opens INTEGER NOT NULL DEFAULT 0 CHECK(opens >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, council_id)
);
--> statement-breakpoint
CREATE INDEX council_campaigns_council_idx ON council_campaigns(council_id, created_at);
--> statement-breakpoint
CREATE TABLE council_attributions (
  opportunity_id TEXT PRIMARY KEY NOT NULL REFERENCES trade_opportunities(id),
  campaign_id TEXT NOT NULL,
  council_id TEXT NOT NULL REFERENCES council_organisations(id),
  attributed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'explicit_referral' CHECK(source = 'explicit_referral'),
  FOREIGN KEY(campaign_id, council_id) REFERENCES council_campaigns(id, council_id)
);
--> statement-breakpoint
CREATE INDEX council_attributions_campaign_idx ON council_attributions(council_id, campaign_id, attributed_at);
--> statement-breakpoint
CREATE TABLE council_scope_requests (
  id TEXT PRIMARY KEY NOT NULL,
  council_id TEXT NOT NULL REFERENCES council_organisations(id),
  postcodes_json TEXT NOT NULL CHECK(json_valid(postcodes_json) AND json_type(postcodes_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  requested_by_uid TEXT NOT NULL,
  reviewed_by_uid TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX council_scope_requests_council_idx ON council_scope_requests(council_id, status, created_at);
