-- Keep synthetic accounts fully usable while preserving a strict separation from live accounts.
UPDATE `trade_accounts`
SET `service_states` = '["ACT","NSW","NT","Qld","SA","Tas","Vic","WA"]',
    `service_radius_km` = 5000
WHERE COALESCE(`is_synthetic`, 0) = 1 AND `partner_type` = 'installer';
--> statement-breakpoint
UPDATE `customer_accounts`
SET `address_state` = CASE `address_state` WHEN 'VIC' THEN 'Vic' WHEN 'QLD' THEN 'Qld' WHEN 'TAS' THEN 'Tas' ELSE `address_state` END
WHERE COALESCE(`is_synthetic`, 0) = 1;
--> statement-breakpoint
UPDATE `customer_projects`
SET `address_state` = CASE `address_state` WHEN 'VIC' THEN 'Vic' WHEN 'QLD' THEN 'Qld' WHEN 'TAS' THEN 'Tas' ELSE `address_state` END,
    `priorities` = '["lower-bills","comfort"]',
    `project_stage` = CASE WHEN `project_stage` = 'ready' THEN 'ready-for-pricing' ELSE 'exploring' END,
    `timing` = CASE WHEN `timing` = 'soon' THEN 'within_30_days' ELSE 'planning' END,
    `budget_range` = CASE `budget_range` WHEN 'under_10k' THEN 'under_5k' WHEN '10k_25k' THEN '5_15k' WHEN '25k_50k' THEN '15_30k' ELSE 'not_set' END
WHERE COALESCE(`is_synthetic`, 0) = 1;
--> statement-breakpoint
UPDATE `trade_opportunities`
SET `state` = CASE `state` WHEN 'VIC' THEN 'Vic' WHEN 'QLD' THEN 'Qld' WHEN 'TAS' THEN 'Tas' ELSE `state` END,
    `priority` = CASE WHEN `priority` = 'high' THEN 'priority' ELSE `priority` END,
    `timing` = CASE WHEN `timing` = 'soon' THEN 'within_30_days' ELSE `timing` END
WHERE COALESCE(`is_synthetic`, 0) = 1;
