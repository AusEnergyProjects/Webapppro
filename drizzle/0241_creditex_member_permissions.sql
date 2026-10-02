ALTER TABLE compliance_users ADD COLUMN permissions_json TEXT DEFAULT NULL CHECK (permissions_json IS NULL OR (json_valid(permissions_json) AND json_type(permissions_json) = 'array'));
ALTER TABLE compliance_invitations ADD COLUMN permissions_json TEXT DEFAULT NULL CHECK (permissions_json IS NULL OR (json_valid(permissions_json) AND json_type(permissions_json) = 'array'));
