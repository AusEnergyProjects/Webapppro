-- Optional public listing link. Issued quotes retain their own immutable snapshot.
ALTER TABLE trade_accounts ADD COLUMN google_business_profile_url TEXT NOT NULL DEFAULT '';
