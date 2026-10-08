ALTER TABLE council_organisations ADD COLUMN public_journey_enabled INTEGER NOT NULL DEFAULT 0 CHECK(public_journey_enabled IN (0,1));
--> statement-breakpoint
ALTER TABLE council_organisations ADD COLUMN public_home_url TEXT CHECK(public_home_url IS NULL OR (length(public_home_url)<=1000 AND public_home_url LIKE 'https://%'));
--> statement-breakpoint
ALTER TABLE council_organisations ADD COLUMN public_hostname TEXT CHECK(public_hostname IS NULL OR (length(public_hostname) BETWEEN 4 AND 253 AND public_hostname=lower(trim(public_hostname))));
--> statement-breakpoint
ALTER TABLE council_organisations ADD COLUMN public_hostname_verified_at TEXT;
--> statement-breakpoint
ALTER TABLE council_organisations ADD COLUMN public_campaign_id TEXT REFERENCES council_campaigns(id);
--> statement-breakpoint
CREATE UNIQUE INDEX council_public_hostname_idx ON council_organisations(public_hostname) WHERE public_hostname IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER council_campaign_count_guard BEFORE INSERT ON council_campaigns
WHEN (SELECT COUNT(*) FROM council_campaigns WHERE council_id=NEW.council_id)>=200
BEGIN SELECT RAISE(ABORT,'COUNCIL_CAMPAIGN_LIMIT'); END;
