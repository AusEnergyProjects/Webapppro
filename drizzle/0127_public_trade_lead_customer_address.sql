ALTER TABLE `public_trade_lead_contact_releases`
  ADD `customer_first_name` text DEFAULT '' NOT NULL;
ALTER TABLE `public_trade_lead_contact_releases`
  ADD `customer_last_name` text DEFAULT '' NOT NULL;
UPDATE `public_trade_lead_contact_releases`
SET
  `customer_first_name` = substr(
    CASE
      WHEN instr(trim(`customer_name`), ' ') > 0
        THEN substr(trim(`customer_name`), 1, instr(trim(`customer_name`), ' ') - 1)
      ELSE trim(`customer_name`)
    END,
    1,
    60
  ),
  `customer_last_name` = substr(
    CASE
      WHEN instr(trim(`customer_name`), ' ') > 0
        THEN ltrim(substr(trim(`customer_name`), instr(trim(`customer_name`), ' ') + 1))
      ELSE ''
    END,
    1,
    60
  );
ALTER TABLE `public_trade_lead_contact_releases`
  ADD `customer_unit_number` text DEFAULT '' NOT NULL;
ALTER TABLE `public_trade_lead_contact_releases`
  ADD `customer_street_address` text DEFAULT '' NOT NULL;
ALTER TABLE `public_trade_lead_contact_releases`
  ADD `customer_suburb` text DEFAULT '' NOT NULL;
ALTER TABLE `public_trade_lead_contact_releases`
  ADD `customer_address_state` text DEFAULT '' NOT NULL;
