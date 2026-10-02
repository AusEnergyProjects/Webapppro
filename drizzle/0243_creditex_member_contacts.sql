ALTER TABLE compliance_users ADD COLUMN phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 30);
ALTER TABLE compliance_users ADD COLUMN job_title TEXT NOT NULL DEFAULT '' CHECK(length(job_title) <= 100);
ALTER TABLE compliance_invitations ADD COLUMN phone TEXT NOT NULL DEFAULT '' CHECK(length(phone) <= 30);
ALTER TABLE compliance_invitations ADD COLUMN job_title TEXT NOT NULL DEFAULT '' CHECK(length(job_title) <= 100);
