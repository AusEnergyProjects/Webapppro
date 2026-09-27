ALTER TABLE trade_network_members ADD COLUMN open_to_work INTEGER NOT NULL DEFAULT 0 CHECK(open_to_work IN (0,1));
ALTER TABLE trade_network_members ADD COLUMN work_trades_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(work_trades_json) AND json_type(work_trades_json)='array');
CREATE INDEX trade_network_members_available_idx ON trade_network_members(enabled,open_to_work,owner_uid);
CREATE INDEX trade_network_posts_work_match_idx ON trade_network_posts(kind,status,trade,state,id);
CREATE TABLE trade_network_leads (
  post_id TEXT NOT NULL REFERENCES trade_network_posts(id),
  recipient_owner_uid TEXT NOT NULL,
  post_revision INTEGER NOT NULL CHECK(post_revision>0),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','viewed','dismissed')),
  matched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(post_id,recipient_owner_uid)
);
CREATE INDEX trade_network_leads_recipient_idx ON trade_network_leads(recipient_owner_uid,status,matched_at,post_id);
