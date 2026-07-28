ALTER TABLE `customer_projects` ADD `goals` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_work_orders` ADD `service_categories` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `trade_crm_enquiries` ADD `service_categories` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `customer_projects`
SET `goals` = json_array(`goal`)
WHERE `goals` = '[]' AND `goal` <> '';--> statement-breakpoint
UPDATE `customer_projects`
SET `budget_range` = 'not_set'
WHERE `budget_range` IN ('under_5k', '5_15k', '15_30k', '30_60k', '60k_plus');--> statement-breakpoint
UPDATE `customer_projects`
SET `property_context` = json_set(
  CASE WHEN json_valid(`property_context`) THEN `property_context` ELSE '{}' END,
  '$.approvalContext',
  'strata'
)
WHERE `household_situation` = 'strata';--> statement-breakpoint
UPDATE `customer_projects`
SET `property_context` = json_remove(`property_context`, '$.occupancy')
WHERE json_valid(`property_context`);--> statement-breakpoint
UPDATE `customer_projects`
SET `household_situation` = ''
WHERE `household_situation` IN ('strata', 'planning-building');--> statement-breakpoint
UPDATE `customer_accounts`
SET `household_situation` = ''
WHERE `household_situation` IN ('strata', 'planning-building');--> statement-breakpoint
UPDATE `trade_work_orders`
SET `service_categories` = json_array(`service_category`)
WHERE `service_categories` = '[]';--> statement-breakpoint
UPDATE `trade_crm_enquiries`
SET `service_categories` = json_array(`service_category`)
WHERE `service_categories` = '[]';--> statement-breakpoint
UPDATE `customer_projects`
SET `service_categories` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`customer_projects`.`service_categories`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`customer_projects`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`customer_projects`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`service_categories`)
  AND EXISTS (
    SELECT 1 FROM json_each(`customer_projects`.`service_categories`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_accounts`
SET `capabilities` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`trade_accounts`.`capabilities`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_accounts`.`capabilities`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_accounts`.`capabilities`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`capabilities`)
  AND EXISTS (
    SELECT 1 FROM json_each(`trade_accounts`.`capabilities`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_opportunities`
SET `service_categories` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`trade_opportunities`.`service_categories`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_opportunities`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_opportunities`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`service_categories`)
  AND EXISTS (
    SELECT 1 FROM json_each(`trade_opportunities`.`service_categories`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_opportunity_matches`
SET `matched_categories` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`trade_opportunity_matches`.`matched_categories`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_opportunity_matches`.`matched_categories`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_opportunity_matches`.`matched_categories`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`matched_categories`)
  AND EXISTS (
    SELECT 1 FROM json_each(`trade_opportunity_matches`.`matched_categories`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_work_orders`
SET `service_categories` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`trade_work_orders`.`service_categories`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_work_orders`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_work_orders`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`service_categories`)
  AND EXISTS (
    SELECT 1 FROM json_each(`trade_work_orders`.`service_categories`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_crm_enquiries`
SET `service_categories` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`trade_crm_enquiries`.`service_categories`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_crm_enquiries`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_crm_enquiries`.`service_categories`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`service_categories`)
  AND EXISTS (
    SELECT 1 FROM json_each(`trade_crm_enquiries`.`service_categories`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_crm_enquiries`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_work_orders`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_handover_packs`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_job_packets`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_crm_job_templates`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_crm_photo_templates`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_crm_photo_template_versions`
SET `service_category` = 'insulation'
WHERE `service_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `trade_form_templates`
SET `categories` = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(`trade_form_templates`.`categories`)
    WHERE value <> 'insulation-draughts'
    UNION
    SELECT 'insulation'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_form_templates`.`categories`)
      WHERE value = 'insulation-draughts'
    )
    UNION
    SELECT 'draught-proofing'
    WHERE EXISTS (
      SELECT 1 FROM json_each(`trade_form_templates`.`categories`)
      WHERE value = 'insulation-draughts'
    )
  )
)
WHERE json_valid(`categories`)
  AND EXISTS (
    SELECT 1 FROM json_each(`trade_form_templates`.`categories`)
    WHERE value = 'insulation-draughts'
  );--> statement-breakpoint
UPDATE `trade_installed_assets`
SET `asset_category` = 'insulation'
WHERE `asset_category` = 'insulation-draughts';--> statement-breakpoint
UPDATE `customer_project_evidence`
SET `file_name` = `category` || '-' || substr(`id`, 1, 8) ||
  CASE `content_type`
    WHEN 'application/pdf' THEN '.pdf'
    WHEN 'image/png' THEN '.png'
    WHEN 'image/webp' THEN '.webp'
    ELSE '.jpg'
  END;
