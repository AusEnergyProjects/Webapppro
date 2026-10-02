ALTER TABLE portal_workspace_profiles ADD COLUMN avatar_revision TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE portal_workspace_profiles ADD COLUMN avatar_object_key TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE portal_workspace_profiles ADD COLUMN avatar_content_type TEXT NOT NULL DEFAULT '' CHECK(avatar_content_type IN ('', 'image/jpeg', 'image/png'));
