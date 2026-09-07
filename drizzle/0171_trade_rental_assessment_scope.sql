ALTER TABLE `trade_rental_inspections`
  ADD COLUMN `assessment_scope` text DEFAULT 'current_minimum_standards' NOT NULL
  CHECK (`assessment_scope` IN ('current_minimum_standards', 'energy_readiness_2027'));
