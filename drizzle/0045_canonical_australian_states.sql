UPDATE trade_accounts SET address_state = UPPER(address_state) WHERE address_state <> UPPER(address_state);
--> statement-breakpoint
UPDATE trade_accounts SET service_states = REPLACE(REPLACE(REPLACE(service_states, '"Vic"', '"VIC"'), '"Qld"', '"QLD"'), '"Tas"', '"TAS"')
  WHERE service_states LIKE '%"Vic"%' OR service_states LIKE '%"Qld"%' OR service_states LIKE '%"Tas"%';
--> statement-breakpoint
UPDATE customer_accounts SET address_state = UPPER(address_state) WHERE address_state <> UPPER(address_state);
--> statement-breakpoint
UPDATE customer_projects SET address_state = UPPER(address_state) WHERE address_state <> UPPER(address_state);
--> statement-breakpoint
UPDATE trade_opportunities SET state = UPPER(state) WHERE state <> UPPER(state);
--> statement-breakpoint
UPDATE trade_crm_customers SET address_state = UPPER(address_state) WHERE address_state <> UPPER(address_state);
