CREATE TABLE portal_team_messages (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL CHECK(workspace IN ('admin','creditex')),
  scope_id TEXT NOT NULL CHECK(length(scope_id)>0),
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  CHECK(workspace<>'admin' OR scope_id='platform'),
  CHECK(sender_id<>recipient_id)
);
--> statement-breakpoint
CREATE INDEX portal_team_messages_conversation ON portal_team_messages(workspace,scope_id,sender_id,recipient_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX portal_team_messages_recipient ON portal_team_messages(workspace,scope_id,recipient_id,sender_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TRIGGER portal_team_messages_no_update BEFORE UPDATE ON portal_team_messages BEGIN SELECT RAISE(ABORT,'PORTAL_MESSAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER portal_team_messages_no_delete BEFORE DELETE ON portal_team_messages BEGIN SELECT RAISE(ABORT,'PORTAL_MESSAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TABLE portal_team_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL CHECK(workspace IN ('admin','creditex')),
  scope_id TEXT NOT NULL CHECK(length(scope_id)>0),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  detail TEXT NOT NULL DEFAULT '' CHECK(length(detail)<=3000),
  assignee_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_uid TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
  due_on TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  CHECK(workspace<>'admin' OR scope_id='platform')
);
--> statement-breakpoint
CREATE INDEX portal_team_tasks_assignee ON portal_team_tasks(workspace,scope_id,assignee_id,status,due_on,created_at DESC);
--> statement-breakpoint
CREATE INDEX portal_team_tasks_creator ON portal_team_tasks(workspace,scope_id,creator_id,status,created_at DESC);
--> statement-breakpoint
CREATE TRIGGER portal_team_task_identity_immutable BEFORE UPDATE ON portal_team_tasks
WHEN NEW.id<>OLD.id OR NEW.workspace<>OLD.workspace OR NEW.scope_id<>OLD.scope_id OR NEW.creator_id<>OLD.creator_id OR NEW.creator_uid<>OLD.creator_uid OR NEW.creator_name<>OLD.creator_name OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'PORTAL_TASK_IDENTITY_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TABLE portal_team_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL CHECK(workspace IN ('admin','creditex')),
  scope_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('task.created','task.edited','task.completed','task.reopened')),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX portal_team_events_entity ON portal_team_events(workspace,scope_id,entity_id,created_at,id);
--> statement-breakpoint
CREATE TRIGGER portal_team_events_no_update BEFORE UPDATE ON portal_team_events BEGIN SELECT RAISE(ABORT,'PORTAL_TEAM_EVENT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER portal_team_events_no_delete BEFORE DELETE ON portal_team_events BEGIN SELECT RAISE(ABORT,'PORTAL_TEAM_EVENT_IMMUTABLE'); END;
