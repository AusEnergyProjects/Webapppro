-- A privacy-safe synthetic business purchasing walkthrough for the first installer and wholesaler demo accounts.
INSERT OR IGNORE INTO `installer_product_lists`
  (`id`, `firebase_uid`, `name`, `project_postcode`, `notes`, `status`, `submitted_at`, `created_at`, `updated_at`)
VALUES
  ('demo-purchasing-list-active', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', 'Richmond solar supply', '3121', 'Trade supply planning only. No household identity or street address.', 'submitted', '2026-07-16T03:00:00.000Z', '2026-07-16T02:45:00.000Z', '2026-07-16T08:15:00.000Z'),
  ('demo-purchasing-list-complete', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', 'Box Hill battery supply', '3128', 'Completed trade supply example using postcode-level planning only.', 'submitted', '2026-07-09T01:00:00.000Z', '2026-07-09T00:45:00.000Z', '2026-07-12T06:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `installer_product_list_items`
  (`id`, `list_id`, `product_id`, `supplier_uid`, `quantity`, `unit_price_cents_ex_gst`, `created_at`, `updated_at`)
VALUES
  ('demo-purchasing-list-item-active', 'demo-purchasing-list-active', 'a2c5f6ec-f31d-4c86-ac1a-f4d6bd53e9c9', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 20, 21900, '2026-07-16T02:50:00.000Z', '2026-07-16T02:50:00.000Z'),
  ('demo-purchasing-list-item-complete', 'demo-purchasing-list-complete', '7d0455c7-b3aa-4a61-a8a6-8c48072cb616', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 1, 684000, '2026-07-09T00:50:00.000Z', '2026-07-09T00:50:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `supplier_product_enquiries`
  (`id`, `list_id`, `installer_uid`, `supplier_uid`, `status`, `message`, `supplier_note`, `created_at`, `updated_at`)
VALUES
  ('demo-supplier-enquiry-active', 'demo-purchasing-list-active', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 'responded', 'Please confirm module stock, pallet availability and collection timing.', 'Stock confirmed. Twelve modules are ready now and the balance is expected within four business days.', '2026-07-16T03:00:00.000Z', '2026-07-16T04:00:00.000Z'),
  ('demo-supplier-enquiry-complete', 'demo-purchasing-list-complete', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 'responded', 'Please confirm battery availability and collection timing.', 'Battery confirmed in stock for trade collection.', '2026-07-09T01:00:00.000Z', '2026-07-09T02:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `trade_purchase_orders`
  (`id`, `order_number`, `enquiry_id`, `list_id`, `installer_uid`, `supplier_uid`, `status`, `installer_reference`, `supplier_reference`, `delivery_method`, `delivery_notes`, `supplier_note`, `expected_at`, `subtotal_cents_ex_gst`, `gst_cents`, `total_cents_inc_gst`, `submitted_at`, `confirmed_at`, `fulfilled_at`, `created_at`, `updated_at`)
VALUES
  ('demo-purchase-order-active', 'PO-000001', 'demo-supplier-enquiry-active', 'demo-purchasing-list-active', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 'part_fulfilled', 'RICH-SOLAR-01', 'AEA-SUP-1042', 'collection', 'Trade counter collection during business hours.', 'Twelve modules supplied. Eight remain allocated to this order.', '2026-07-20', 438000, 43800, 481800, '2026-07-16T05:00:00.000Z', '2026-07-16T06:00:00.000Z', '', '2026-07-16T05:00:00.000Z', '2026-07-16T08:00:00.000Z'),
  ('demo-purchase-order-complete', 'PO-000002', 'demo-supplier-enquiry-complete', 'demo-purchasing-list-complete', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 'fulfilled', 'BOX-BATT-01', 'AEA-SUP-0998', 'collection', 'Trade counter collection completed.', 'Order supplied in full.', '2026-07-12', 684000, 68400, 752400, '2026-07-09T03:00:00.000Z', '2026-07-09T04:00:00.000Z', '2026-07-12T06:00:00.000Z', '2026-07-09T03:00:00.000Z', '2026-07-12T06:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `trade_purchase_order_items`
  (`id`, `purchase_order_id`, `supplier_product_id`, `model_number`, `brand`, `product_name`, `unit_label`, `quantity`, `fulfilled_quantity`, `unit_price_cents_ex_gst`, `warranty_years`, `created_at`, `updated_at`)
VALUES
  ('demo-purchase-order-item-active', 'demo-purchase-order-active', 'a2c5f6ec-f31d-4c86-ac1a-f4d6bd53e9c9', 'SP-440-01-1', 'SunPeak', '440W solar module', 'each', 20, 12, 21900, 25, '2026-07-16T05:00:00.000Z', '2026-07-16T08:00:00.000Z'),
  ('demo-purchase-order-item-complete', 'demo-purchase-order-complete', '7d0455c7-b3aa-4a61-a8a6-8c48072cb616', 'VS-10-01-2', 'VoltStore', '10 kWh home battery', 'each', 1, 1, 684000, 10, '2026-07-09T03:00:00.000Z', '2026-07-12T06:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `trade_purchase_order_events`
  (`id`, `purchase_order_id`, `event_type`, `status`, `summary`, `actor_type`, `actor_uid`, `created_at`)
VALUES
  ('demo-po-active-event-1', 'demo-purchase-order-active', 'order_submitted', 'submitted', 'PO-000001 submitted to the wholesaler.', 'installer', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '2026-07-16T05:00:00.000Z'),
  ('demo-po-active-event-2', 'demo-purchase-order-active', 'order_status_updated', 'confirmed', 'Wholesaler confirmed stock allocation and collection timing.', 'supplier', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', '2026-07-16T06:00:00.000Z'),
  ('demo-po-active-event-3', 'demo-purchase-order-active', 'order_status_updated', 'part_fulfilled', 'Twelve of twenty modules supplied. Eight remain allocated.', 'supplier', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', '2026-07-16T08:00:00.000Z'),
  ('demo-po-active-event-4', 'demo-purchase-order-active', 'warranty_claim_submitted', 'reviewing', 'WTY-000001 lodged against one supplied module.', 'installer', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '2026-07-16T08:15:00.000Z'),
  ('demo-po-complete-event-1', 'demo-purchase-order-complete', 'order_submitted', 'submitted', 'PO-000002 submitted to the wholesaler.', 'installer', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '2026-07-09T03:00:00.000Z'),
  ('demo-po-complete-event-2', 'demo-purchase-order-complete', 'order_status_updated', 'fulfilled', 'Battery supplied in full and order completed.', 'supplier', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', '2026-07-12T06:00:00.000Z');
--> statement-breakpoint
INSERT OR IGNORE INTO `trade_warranty_claims`
  (`id`, `claim_number`, `purchase_order_id`, `purchase_order_item_id`, `installer_uid`, `supplier_uid`, `status`, `issue_category`, `summary`, `serial_number`, `supplier_response`, `resolution`, `submitted_at`, `resolved_at`, `created_at`, `updated_at`)
VALUES
  ('demo-warranty-claim-active', 'WTY-000001', 'demo-purchase-order-active', 'demo-purchase-order-item-active', 'laf3JhhjHEMSAnamsRcfKMkB1vq2', '1Q8tcnQnn5TunrwEL8Ko1JHqDwA2', 'reviewing', 'damaged_on_arrival', 'One module frame was visibly bent at trade collection and has been isolated from installation.', 'SP440-DEMO-0012', 'Wholesaler has requested a product photo and set aside a replacement module.', '', '2026-07-16T08:15:00.000Z', '', '2026-07-16T08:15:00.000Z', '2026-07-16T08:30:00.000Z');
--> statement-breakpoint
INSERT INTO `trade_crm_counters` (`firebase_uid`, `counter_key`, `last_value`, `updated_at`)
VALUES
  ('laf3JhhjHEMSAnamsRcfKMkB1vq2', 'po', 2, '2026-07-16T08:30:00.000Z'),
  ('laf3JhhjHEMSAnamsRcfKMkB1vq2', 'wty', 1, '2026-07-16T08:30:00.000Z')
ON CONFLICT (`firebase_uid`, `counter_key`) DO UPDATE SET `last_value` = MAX(`last_value`, excluded.`last_value`), `updated_at` = excluded.`updated_at`;
