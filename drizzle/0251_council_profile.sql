ALTER TABLE council_organisations ADD COLUMN logo_data_url TEXT
  CHECK(logo_data_url IS NULL OR (length(logo_data_url)<=349560 AND
    (logo_data_url LIKE 'data:image/png;base64,%' OR logo_data_url LIKE 'data:image/jpeg;base64,%' OR logo_data_url LIKE 'data:image/webp;base64,%')));
--> statement-breakpoint
ALTER TABLE council_organisations ADD COLUMN primary_color TEXT NOT NULL DEFAULT '#032733'
  CHECK(length(primary_color)=7 AND substr(primary_color,1,1)='#' AND substr(primary_color,2) NOT GLOB '*[^0-9a-fA-F]*');
--> statement-breakpoint
ALTER TABLE council_organisations ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#0b765d'
  CHECK(length(accent_color)=7 AND substr(accent_color,1,1)='#' AND substr(accent_color,2) NOT GLOB '*[^0-9a-fA-F]*');
