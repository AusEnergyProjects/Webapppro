ALTER TABLE `admin_notifications` ADD `assigned_to_uid` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_notifications` ADD `assigned_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `admin_notifications` ADD `due_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `admin_notifications_assignee_idx` ON `admin_notifications` (`assigned_to_uid`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `admin_notifications_due_idx` ON `admin_notifications` (`status`,`due_at`);
--> statement-breakpoint
UPDATE `admin_notifications`
SET `due_at` = CASE `priority`
  WHEN 'urgent' THEN strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+2 hours')
  WHEN 'high' THEN strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+8 hours')
  WHEN 'low' THEN strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+72 hours')
  ELSE strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, '+24 hours')
END
WHERE `requires_action` = 1 AND `status` != 'resolved' AND `due_at` = '';
