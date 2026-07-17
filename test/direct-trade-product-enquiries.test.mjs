import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const schema = read("../db/schema.ts");
const selections = read("../src/app/api/product-selections/route.ts");
const supplierEnquiries = read("../src/app/api/supplier-enquiries/route.ts");
const adminEnquiries = read("../src/app/api/admin/product-enquiries/route.ts");
const installerUi = read("../src/components/InstallerProductMarketplace.tsx");
const supplierUi = read("../src/components/SupplierCatalogueWorkspace.tsx");
const adminUi = read("../src/components/AdminOperationsPortal.tsx");
const adminEnquiryWorkspace = read("../src/components/AdminProductEnquiryWorkspace.tsx");

test("project product lists and wholesaler enquiries are durable", () => {
  assert.match(schema, /sqliteTable\("installer_product_lists"/);
  assert.match(schema, /sqliteTable\("installer_product_list_items"/);
  assert.match(schema, /sqliteTable\("supplier_product_enquiries"/);
  assert.match(schema, /installer_product_list_items_unique_idx/);
  assert.match(schema, /supplier_product_enquiries_list_supplier_idx/);
  assert.match(selections, /unit_price_cents_ex_gst/);
  assert.match(selections, /ON CONFLICT\(list_id, product_id\) DO UPDATE/);
  assert.match(selections, /SELECT DISTINCT supplier_uid/);
});

test("installer selection enforces verification, ownership and wholesaler visibility", () => {
  assert.match(selections, /requireFirebaseIdentity/);
  assert.match(selections, /accountHasFeature/);
  assert.match(selections, /installer_marketplace/);
  assert.match(selections, /firebase_uid = \? AND status = 'draft'/);
  assert.match(selections, /a\.verification_status = 'approved'/);
  assert.doesNotMatch(selections, /fg\.feature_key = 'supplier_visibility'/);
  assert.match(selections, /p\.listing_status = 'published'/);
  assert.match(selections, /p\.review_status = 'approved'/);
  assert.match(selections, /Quantity must start at/);
});

test("each wholesaler sees only its selected items and installer business contact", () => {
  assert.match(supplierEnquiries, /WHERE e\.supplier_uid = \?/);
  assert.match(supplierEnquiries, /WHERE i\.supplier_uid = \?/);
  assert.match(supplierEnquiries, /WHERE id = \? AND supplier_uid = \?/);
  assert.match(supplierEnquiries, /installer_business/);
  assert.doesNotMatch(supplierEnquiries, /address_line_1|customer_email|customer_phone/);
  assert.match(installerUi, /Each wholesaler receives only its own products/);
  assert.match(supplierUi, /no household names, street addresses or customer contact details/i);
});

test("operations can monitor product demand without receiving household data", () => {
  assert.match(adminEnquiries, /sameOrigin\(request\)/);
  assert.match(adminEnquiries, /requireAdminIdentity\(request\)/);
  assert.match(adminEnquiries, /subtotal_cents_ex_gst/);
  assert.doesNotMatch(adminEnquiries, /address_line_1|customer_email|customer_phone/);
  assert.match(adminUi, /AdminProductEnquiryWorkspace/);
  assert.match(adminEnquiryWorkspace, /Installer product enquiries/);
  assert.match(adminUi, /Product enquiries awaiting wholesaler response/);
  assert.match(adminEnquiryWorkspace, /Household contact details\s+and street addresses are outside this workflow/);
});

test("the extracted enquiry workspace preserves search, status filtering, summaries and privacy boundaries", () => {
  assert.match(adminEnquiryWorkspace, /params\.set\("search"/);
  assert.match(adminEnquiryWorkspace, /params\.set\("status"/);
  assert.match(adminEnquiryWorkspace, /summariseProductEnquiries/);
  assert.match(adminEnquiryWorkspace, /Awaiting response/);
  assert.match(adminEnquiryWorkspace, /Installer/);
  assert.match(adminEnquiryWorkspace, /Wholesaler/);
  assert.doesNotMatch(adminEnquiryWorkspace, /household_name|customer_email|customer_phone|street_address/);
});

test("new product workflow copy avoids prohibited dash characters", () => {
  assert.doesNotMatch(installerUi + supplierUi + adminUi + adminEnquiryWorkspace, /[\u2013\u2014]/);
});
