ALTER TABLE trade_mobile_devices ADD COLUMN voip_push_token TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE trade_mobile_devices ADD COLUMN native_call_capable INTEGER NOT NULL DEFAULT 0
  CONSTRAINT trade_mobile_devices_native_call_capable_check CHECK(native_call_capable IN (0, 1));
--> statement-breakpoint
ALTER TABLE compliance_manual_field_devices ADD COLUMN voip_push_token TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE compliance_manual_field_devices ADD COLUMN native_call_capable INTEGER NOT NULL DEFAULT 0
  CONSTRAINT compliance_manual_field_device_native_call_capable_check CHECK(native_call_capable IN (0, 1));
