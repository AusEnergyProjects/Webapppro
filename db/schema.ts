import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tradeAccounts = sqliteTable("trade_accounts", {
  firebaseUid: text("firebase_uid").primaryKey(),
  email: text("email").notNull(),
  businessName: text("business_name").notNull(),
  addressLine1: text("address_line_1").notNull().default(""),
  suburb: text("suburb").notNull().default(""),
  addressState: text("address_state").notNull().default(""),
  postcode: text("postcode").notNull().default(""),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull().default(""),
  partnerType: text("partner_type").notNull().default("installer"),
  businessWebsite: text("business_website").notNull().default(""),
  serviceStates: text("service_states").notNull().default("[]"),
  capabilities: text("capabilities").notNull().default("[]"),
  summary: text("summary").notNull().default(""),
  accountStatus: text("account_status").notNull().default("active"),
  verificationStatus: text("verification_status").notNull().default("not_started"),
  planKey: text("plan_key").notNull().default("unselected"),
  billingStatus: text("billing_status").notNull().default("not_connected"),
  availabilityStatus: text("availability_status").notNull().default("paused"),
  serviceBasePostcode: text("service_base_postcode").notNull().default(""),
  serviceRadiusKm: integer("service_radius_km").notNull().default(50),
  emailOpportunities: integer("email_opportunities", { mode: "boolean" }).notNull().default(true),
  emailWeeklySummary: integer("email_weekly_summary", { mode: "boolean" }).notNull().default(true),
  settingsUpdatedAt: text("settings_updated_at").notNull().default(""),
  consentVersion: text("consent_version").notNull(),
  consentAt: text("consent_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const stripeMemberships = sqliteTable("stripe_memberships", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  partnerType: text("partner_type").notNull(),
  planKey: text("plan_key").notNull(),
  paymentLinkId: text("payment_link_id").notNull(),
  stripeCustomerId: text("stripe_customer_id").notNull().default(""),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  status: text("status").notNull(),
  cancelAtPeriodEnd: integer("cancel_at_period_end", {
    mode: "boolean",
  }).notNull().default(false),
  currentPeriodEnd: integer("current_period_end").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("stripe_memberships_subscription_idx").on(table.stripeSubscriptionId),
  index("stripe_memberships_owner_idx").on(table.firebaseUid, table.updatedAt),
]);

export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("stripe_webhook_events_created_idx").on(table.createdAt),
]);

export const leadRateLimits = sqliteTable("lead_rate_limits", {
  clientHash: text("client_hash").primaryKey(),
  timestamps: text("timestamps").notNull().default("[]"),
  version: integer("version").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("lead_rate_limits_updated_idx").on(table.updatedAt),
]);

export const tradeReferralCodes = sqliteTable("trade_referral_codes", {
  code: text("code").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_referral_codes_owner_idx").on(table.firebaseUid),
  index("trade_referral_codes_status_idx").on(table.status),
]);

export const tradeReferrals = sqliteTable("trade_referrals", {
  id: text("id").primaryKey(),
  referralCode: text("referral_code").notNull(),
  referrerUid: text("referrer_uid").notNull(),
  referredUid: text("referred_uid").notNull(),
  status: text("status").notNull().default("registered"),
  riskReason: text("risk_reason").notNull().default(""),
  referredSubscriptionId: text("referred_subscription_id").notNull().default(""),
  registeredAt: text("registered_at").notNull(),
  firstPaidAt: text("first_paid_at").notNull().default(""),
  rewardedAt: text("rewarded_at").notNull().default(""),
  reviewedByUid: text("reviewed_by_uid").notNull().default(""),
  reviewedAt: text("reviewed_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_referrals_referred_idx").on(table.referredUid),
  index("trade_referrals_referrer_idx").on(table.referrerUid, table.createdAt),
  index("trade_referrals_code_idx").on(table.referralCode),
  index("trade_referrals_status_idx").on(table.status, table.updatedAt),
]);

export const tradeMembershipCredits = sqliteTable("trade_membership_credits", {
  id: text("id").primaryKey(),
  referralId: text("referral_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  beneficiaryRole: text("beneficiary_role").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  status: text("status").notNull().default("pending"),
  extensionStart: integer("extension_start").notNull().default(0),
  extensionEnd: integer("extension_end").notNull().default(0),
  stripeRequestId: text("stripe_request_id").notNull().default(""),
  failureCode: text("failure_code").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_membership_credits_beneficiary_idx").on(table.referralId, table.firebaseUid),
  index("trade_membership_credits_owner_idx").on(table.firebaseUid, table.createdAt),
  index("trade_membership_credits_status_idx").on(table.status, table.updatedAt),
]);

export const verificationDocuments = sqliteTable("verification_documents", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectKey: text("object_key").notNull().unique(),
  expiryDate: text("expiry_date").notNull().default(""),
  status: text("status").notNull().default("uploaded"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("verification_documents_owner_idx").on(table.firebaseUid),
]);

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull().default(""),
  role: text("role").notNull().default("support"),
  status: text("status").notNull().default("active"),
  invitedByUid: text("invited_by_uid").notNull().default(""),
  lastLoginAt: text("last_login_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("admin_users_firebase_uid_idx").on(table.firebaseUid),
  uniqueIndex("admin_users_email_idx").on(table.email),
  index("admin_users_status_idx").on(table.status),
]);

export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: text("id").primaryKey(),
  adminUid: text("admin_uid").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("admin_audit_log_created_idx").on(table.createdAt),
  index("admin_audit_log_admin_idx").on(table.adminUid),
  index("admin_audit_log_entity_idx").on(table.entityType, table.entityId),
]);

export const tradeAccountNotes = sqliteTable("trade_account_notes", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  note: text("note").notNull(),
  createdByUid: text("created_by_uid").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("trade_account_notes_owner_idx").on(table.firebaseUid, table.createdAt),
]);

export const tradeAccountFeatureGrants = sqliteTable("trade_account_feature_grants", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  featureKey: text("feature_key").notNull(),
  status: text("status").notNull().default("active"),
  expiresAt: text("expires_at").notNull().default(""),
  note: text("note").notNull().default(""),
  grantedByUid: text("granted_by_uid").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_account_feature_grants_owner_key_idx").on(table.firebaseUid, table.featureKey),
  index("trade_account_feature_grants_owner_idx").on(table.firebaseUid, table.status, table.expiresAt),
]);

export const tradeOpportunities = sqliteTable("trade_opportunities", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  projectType: text("project_type").notNull(),
  postcode: text("postcode").notNull().default(""),
  state: text("state").notNull(),
  serviceCategories: text("service_categories").notNull().default("[]"),
  priority: text("priority").notNull().default("standard"),
  timing: text("timing").notNull().default("planning"),
  summary: text("summary").notNull(),
  status: text("status").notNull().default("draft"),
  sourceReference: text("source_reference").notNull().default(""),
  contactLimit: integer("contact_limit").notNull().default(2),
  maximumConnectedInstallers: integer("maximum_connected_installers").notNull().default(3),
  expiresAt: text("expires_at").notNull().default(""),
  expiredAt: text("expired_at").notNull().default(""),
  createdByUid: text("created_by_uid").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_opportunities_status_idx").on(table.status, table.updatedAt),
  index("trade_opportunities_state_idx").on(table.state),
]);

export const tradeOpportunityMatches = sqliteTable("trade_opportunity_matches", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  status: text("status").notNull().default("offered"),
  adminNote: text("admin_note").notNull().default(""),
  partnerNote: text("partner_note").notNull().default(""),
  matchedCategories: text("matched_categories").notNull().default("[]"),
  distanceMetres: integer("distance_metres").notNull().default(0),
  allocationRank: integer("allocation_rank").notNull().default(0),
  matchSource: text("match_source").notNull().default("manual"),
  contactAttemptCount: integer("contact_attempt_count").notNull().default(0),
  lastContactAt: text("last_contact_at").notNull().default(""),
  connectedAt: text("connected_at").notNull().default(""),
  matchedByUid: text("matched_by_uid").notNull(),
  matchedAt: text("matched_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_opportunity_matches_unique_idx").on(table.opportunityId, table.firebaseUid),
  index("trade_opportunity_matches_owner_idx").on(table.firebaseUid, table.updatedAt),
  index("trade_opportunity_matches_opportunity_idx").on(table.opportunityId),
  index("trade_opportunity_matches_status_idx").on(table.status),
]);

export const supplierProducts = sqliteTable("supplier_products", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  modelNumber: text("model_number").notNull(),
  brand: text("brand").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  unitPriceCentsExGst: integer("unit_price_cents_ex_gst").notNull(),
  minOrderQty: integer("min_order_qty").notNull().default(1),
  orderIncrement: integer("order_increment").notNull().default(1),
  unitLabel: text("unit_label").notNull().default("each"),
  stockStatus: text("stock_status").notNull().default("order_in"),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
  warrantyYears: integer("warranty_years").notNull().default(0),
  datasheetUrl: text("datasheet_url").notNull().default(""),
  listingStatus: text("listing_status").notNull().default("draft"),
  reviewStatus: text("review_status").notNull().default("pending"),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("supplier_products_owner_model_idx").on(table.firebaseUid, table.modelNumber),
  index("supplier_products_owner_idx").on(table.firebaseUid, table.updatedAt),
  index("supplier_products_listing_idx").on(table.listingStatus, table.reviewStatus),
  index("supplier_products_category_idx").on(table.category),
]);

export const supplierProductLinks = sqliteTable("supplier_product_links", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  productId: text("product_id").notNull(),
  linkedProductId: text("linked_product_id").notNull(),
  relationship: text("relationship").notNull().default("recommended"),
  defaultQty: integer("default_qty").notNull().default(1),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("supplier_product_links_unique_idx").on(table.productId, table.linkedProductId, table.relationship),
  index("supplier_product_links_owner_idx").on(table.firebaseUid),
  index("supplier_product_links_product_idx").on(table.productId),
]);
