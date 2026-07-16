UPDATE `supplier_products`
SET `review_status` = 'approved',
    `review_note` = 'Synthetic walkthrough auto-approval'
WHERE COALESCE(`is_synthetic`, 0) = 1 AND `review_status` = 'pending';
