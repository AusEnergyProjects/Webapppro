ALTER TABLE `trade_price_book_items` ADD COLUMN `category` text NOT NULL DEFAULT '' CONSTRAINT `trade_price_book_items_category_length` CHECK (length(`category`) <= 80);
