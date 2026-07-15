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

export const adminNotifications = sqliteTable("admin_notifications", {
  id: text("id").primaryKey(),
  eventKey: text("event_key").notNull(),
  eventType: text("event_type").notNull(),
  category: text("category").notNull(),
  priority: text("priority").notNull().default("normal"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  actorType: text("actor_type").notNull().default("system"),
  actorUid: text("actor_uid").notNull().default(""),
  requiresAction: integer("requires_action", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("open"),
  readAt: text("read_at").notNull().default(""),
  readByUid: text("read_by_uid").notNull().default(""),
  resolvedAt: text("resolved_at").notNull().default(""),
  resolvedByUid: text("resolved_by_uid").notNull().default(""),
  resolutionNote: text("resolution_note").notNull().default(""),
  assignedToUid: text("assigned_to_uid").notNull().default(""),
  assignedAt: text("assigned_at").notNull().default(""),
  dueAt: text("due_at").notNull().default(""),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("admin_notifications_event_key_idx").on(table.eventKey),
  index("admin_notifications_status_idx").on(table.status, table.createdAt),
  index("admin_notifications_action_idx").on(table.requiresAction, table.status, table.createdAt),
  index("admin_notifications_category_idx").on(table.category, table.createdAt),
  index("admin_notifications_entity_idx").on(table.entityType, table.entityId),
  index("admin_notifications_assignee_idx").on(table.assignedToUid, table.status, table.dueAt),
  index("admin_notifications_due_idx").on(table.status, table.dueAt),
]);

export const adminNotificationDeliveries = sqliteTable("admin_notification_deliveries", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").notNull(),
  channel: text("channel").notNull().default("webhook"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at").notNull().default(""),
  lastAttemptAt: text("last_attempt_at").notNull().default(""),
  deliveredAt: text("delivered_at").notNull().default(""),
  lastError: text("last_error").notNull().default(""),
  responseCode: integer("response_code").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("admin_notification_deliveries_notification_channel_idx").on(table.notificationId, table.channel),
  index("admin_notification_deliveries_status_idx").on(table.status, table.nextAttemptAt),
  index("admin_notification_deliveries_notification_idx").on(table.notificationId, table.createdAt),
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

export const customerAccountNotes = sqliteTable("customer_account_notes", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  note: text("note").notNull(),
  createdByUid: text("created_by_uid").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("customer_account_notes_owner_idx").on(table.firebaseUid, table.createdAt),
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

export const tradeWorkOrders = sqliteTable("trade_work_orders", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  partnerType: text("partner_type").notNull(),
  workType: text("work_type").notNull().default("job"),
  sourceType: text("source_type").notNull().default("internal"),
  sourceReference: text("source_reference").notNull().default(""),
  workNumber: text("work_number").notNull(),
  title: text("title").notNull(),
  serviceCategory: text("service_category").notNull().default("other"),
  siteArea: text("site_area").notNull().default(""),
  stage: text("stage").notNull().default("backlog"),
  priority: text("priority").notNull().default("standard"),
  scheduledStart: text("scheduled_start").notNull().default(""),
  scheduledEnd: text("scheduled_end").notNull().default(""),
  assigneeLabel: text("assignee_label").notNull().default(""),
  recordStatus: text("record_status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_work_orders_owner_number_idx").on(table.firebaseUid, table.workNumber),
  index("trade_work_orders_owner_stage_idx").on(table.firebaseUid, table.recordStatus, table.stage, table.updatedAt),
  index("trade_work_orders_source_idx").on(table.firebaseUid, table.sourceType, table.sourceReference),
]);

export const tradeWorkOrderTasks = sqliteTable("trade_work_order_tasks", {
  id: text("id").primaryKey(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  title: text("title").notNull(),
  dueAt: text("due_at").notNull().default(""),
  status: text("status").notNull().default("pending"),
  completedAt: text("completed_at").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_work_order_tasks_owner_idx").on(table.firebaseUid, table.status, table.dueAt),
  index("trade_work_order_tasks_order_idx").on(table.workOrderId, table.sortOrder, table.createdAt),
]);

export const tradeWorkOrderEvents = sqliteTable("trade_work_order_events", {
  id: text("id").primaryKey(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  eventType: text("event_type").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("trade_work_order_events_owner_idx").on(table.firebaseUid, table.createdAt),
  index("trade_work_order_events_order_idx").on(table.workOrderId, table.createdAt),
]);

export const tradeHandoverPacks = sqliteTable("trade_handover_packs", {
  id: text("id").primaryKey(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  customerProjectId: text("customer_project_id").notNull().default(""),
  serviceCategory: text("service_category").notNull().default("other"),
  status: text("status").notNull().default("draft"),
  submittedAt: text("submitted_at").notNull().default(""),
  publishedAt: text("published_at").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  reviewedByUid: text("reviewed_by_uid").notNull().default(""),
  reviewedAt: text("reviewed_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_handover_packs_work_order_idx").on(table.workOrderId),
  index("trade_handover_packs_owner_idx").on(table.firebaseUid, table.status, table.updatedAt),
  index("trade_handover_packs_customer_project_idx").on(table.customerProjectId, table.status, table.publishedAt),
]);

export const tradeInstalledAssets = sqliteTable("trade_installed_assets", {
  id: text("id").primaryKey(),
  handoverPackId: text("handover_pack_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  assetCategory: text("asset_category").notNull(),
  brand: text("brand").notNull(),
  modelNumber: text("model_number").notNull(),
  serialNumber: text("serial_number").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  installedAt: text("installed_at").notNull().default(""),
  warrantyProvider: text("warranty_provider").notNull().default(""),
  warrantyReference: text("warranty_reference").notNull().default(""),
  warrantyStart: text("warranty_start").notNull().default(""),
  warrantyEnd: text("warranty_end").notNull().default(""),
  supplierProductId: text("supplier_product_id").notNull().default(""),
  recordStatus: text("record_status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_installed_assets_pack_idx").on(table.handoverPackId, table.recordStatus, table.createdAt),
  index("trade_installed_assets_owner_idx").on(table.firebaseUid, table.workOrderId, table.recordStatus),
  index("trade_installed_assets_warranty_idx").on(table.firebaseUid, table.warrantyEnd),
]);

export const tradeComplianceItems = sqliteTable("trade_compliance_items", {
  id: text("id").primaryKey(),
  handoverPackId: text("handover_pack_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  templateKey: text("template_key").notNull(),
  label: text("label").notNull(),
  guidance: text("guidance").notNull().default(""),
  status: text("status").notNull().default("pending"),
  completedAt: text("completed_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_compliance_items_pack_key_idx").on(table.handoverPackId, table.templateKey),
  index("trade_compliance_items_owner_idx").on(table.firebaseUid, table.workOrderId, table.status),
]);

export const tradeHandoverDocuments = sqliteTable("trade_handover_documents", {
  id: text("id").primaryKey(),
  handoverPackId: text("handover_pack_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  category: text("category").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectKey: text("object_key").notNull().unique(),
  customerVisible: integer("customer_visible", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_handover_documents_pack_idx").on(table.handoverPackId, table.createdAt),
  index("trade_handover_documents_owner_idx").on(table.firebaseUid, table.workOrderId, table.createdAt),
]);

export const tradeAssetServicePlans = sqliteTable("trade_asset_service_plans", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  handoverPackId: text("handover_pack_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  serviceType: text("service_type").notNull(),
  cadenceMonths: integer("cadence_months").notNull(),
  nextDueAt: text("next_due_at").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("trade_asset_service_plans_asset_type_idx").on(table.assetId, table.serviceType),
  index("trade_asset_service_plans_owner_due_idx").on(table.firebaseUid, table.status, table.nextDueAt),
  index("trade_asset_service_plans_pack_idx").on(table.handoverPackId, table.status, table.nextDueAt),
]);

export const tradeAssetServiceEvents = sqliteTable("trade_asset_service_events", {
  id: text("id").primaryKey(),
  servicePlanId: text("service_plan_id").notNull(),
  assetId: text("asset_id").notNull(),
  handoverPackId: text("handover_pack_id").notNull(),
  workOrderId: text("work_order_id").notNull(),
  firebaseUid: text("firebase_uid").notNull(),
  eventType: text("event_type").notNull().default("service_completed"),
  servicedAt: text("serviced_at").notNull(),
  summary: text("summary").notNull().default(""),
  providerReference: text("provider_reference").notNull().default(""),
  nextDueAt: text("next_due_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("trade_asset_service_events_plan_idx").on(table.servicePlanId, table.servicedAt),
  index("trade_asset_service_events_asset_idx").on(table.assetId, table.servicedAt),
  index("trade_asset_service_events_owner_idx").on(table.firebaseUid, table.createdAt),
]);

export const customerAssetLifecyclePreferences = sqliteTable("customer_asset_lifecycle_preferences", {
  id: text("id").primaryKey(),
  customerUid: text("customer_uid").notNull(),
  assetId: text("asset_id").notNull(),
  remindersEnabled: integer("reminders_enabled", { mode: "boolean" }).notNull().default(true),
  reminderLeadDays: integer("reminder_lead_days").notNull().default(30),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("customer_asset_lifecycle_preferences_owner_asset_idx").on(table.customerUid, table.assetId),
  index("customer_asset_lifecycle_preferences_owner_idx").on(table.customerUid, table.updatedAt),
]);

export const assetSafetyNotices = sqliteTable("asset_safety_notices", {
  id: text("id").primaryKey(),
  createdByUid: text("created_by_uid").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  severity: text("severity").notNull().default("advisory"),
  assetCategory: text("asset_category").notNull().default(""),
  brand: text("brand").notNull().default(""),
  modelNumber: text("model_number").notNull().default(""),
  sourceUrl: text("source_url").notNull(),
  sourceLabel: text("source_label").notNull().default("Official safety source"),
  effectiveAt: text("effective_at").notNull().default(""),
  expiresAt: text("expires_at").notNull().default(""),
  status: text("status").notNull().default("draft"),
  publishedAt: text("published_at").notNull().default(""),
  withdrawnAt: text("withdrawn_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("asset_safety_notices_status_idx").on(table.status, table.publishedAt),
  index("asset_safety_notices_scope_idx").on(table.assetCategory, table.brand, table.modelNumber),
]);

export const assetSafetyAcknowledgements = sqliteTable("asset_safety_acknowledgements", {
  id: text("id").primaryKey(),
  noticeId: text("notice_id").notNull(),
  assetId: text("asset_id").notNull(),
  customerUid: text("customer_uid").notNull(),
  status: text("status").notNull().default("acknowledged"),
  acknowledgedAt: text("acknowledged_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("asset_safety_acknowledgements_owner_notice_asset_idx").on(table.customerUid, table.noticeId, table.assetId),
  index("asset_safety_acknowledgements_notice_idx").on(table.noticeId, table.acknowledgedAt),
  index("asset_safety_acknowledgements_owner_idx").on(table.customerUid, table.updatedAt),
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

export const customerAccounts = sqliteTable("customer_accounts", {
  firebaseUid: text("firebase_uid").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  postcode: text("postcode").notNull().default(""),
  addressState: text("address_state").notNull().default(""),
  propertyType: text("property_type").notNull().default("house"),
  householdSituation: text("household_situation").notNull().default("owner"),
  accountUpdates: integer("account_updates", { mode: "boolean" }).notNull().default(false),
  accountStatus: text("account_status").notNull().default("active"),
  consentVersion: text("consent_version").notNull(),
  consentAt: text("consent_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("customer_accounts_email_idx").on(table.email),
  index("customer_accounts_status_idx").on(table.accountStatus, table.updatedAt),
]);

export const customerProjects = sqliteTable("customer_projects", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  title: text("title").notNull(),
  homeNickname: text("home_nickname").notNull().default("My home"),
  postcode: text("postcode").notNull(),
  addressState: text("address_state").notNull(),
  propertyType: text("property_type").notNull(),
  householdSituation: text("household_situation").notNull(),
  goal: text("goal").notNull(),
  pace: text("pace").notNull(),
  existingFeatures: text("existing_features").notNull().default("[]"),
  serviceCategories: text("service_categories").notNull().default("[]"),
  priorities: text("priorities").notNull().default("[]"),
  projectStage: text("project_stage").notNull().default("exploring"),
  timing: text("timing").notNull().default("planning"),
  budgetRange: text("budget_range").notNull().default("not_set"),
  privateNotes: text("private_notes").notNull().default(""),
  planSnapshot: text("plan_snapshot").notNull().default("{}"),
  completedPlanItems: text("completed_plan_items").notNull().default("[]"),
  status: text("status").notNull().default("draft"),
  opportunityId: text("opportunity_id").notNull().default(""),
  submittedAt: text("submitted_at").notNull().default(""),
  archivedAt: text("archived_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("customer_projects_owner_idx").on(table.firebaseUid, table.status, table.updatedAt),
  index("customer_projects_opportunity_idx").on(table.opportunityId),
]);

export const customerConsentReceipts = sqliteTable("customer_consent_receipts", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  projectId: text("project_id").notNull().default(""),
  purpose: text("purpose").notNull(),
  noticeVersion: text("notice_version").notNull(),
  grantedAt: text("granted_at").notNull(),
  withdrawnAt: text("withdrawn_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("customer_consent_receipts_owner_idx").on(table.firebaseUid, table.createdAt),
  index("customer_consent_receipts_project_idx").on(table.projectId, table.createdAt),
]);

export const customerProjectQuotes = sqliteTable("customer_project_quotes", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  opportunityMatchId: text("opportunity_match_id").notNull(),
  installerUid: text("installer_uid").notNull(),
  productListId: text("product_list_id").notNull().default(""),
  inclusions: text("inclusions").notNull().default("[]"),
  productSnapshot: text("product_snapshot").notNull().default("[]"),
  productSubtotalCentsExGst: integer("product_subtotal_cents_ex_gst").notNull().default(0),
  labourCentsExGst: integer("labour_cents_ex_gst").notNull().default(0),
  otherCentsExGst: integer("other_cents_ex_gst").notNull().default(0),
  totalCentsExGst: integer("total_cents_ex_gst").notNull().default(0),
  quoteType: text("quote_type").notNull().default("indicative"),
  startWindow: text("start_window").notNull().default("to_confirm"),
  durationWeeks: integer("duration_weeks").notNull().default(0),
  workmanshipWarrantyYears: integer("workmanship_warranty_years").notNull().default(0),
  status: text("status").notNull().default("submitted"),
  customerDecision: text("customer_decision").notNull().default("reviewing"),
  submittedAt: text("submitted_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("customer_project_quotes_match_idx").on(table.opportunityMatchId),
  index("customer_project_quotes_project_idx").on(table.projectId, table.status, table.updatedAt),
  index("customer_project_quotes_installer_idx").on(table.installerUid, table.updatedAt),
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

export const installerProductLists = sqliteTable("installer_product_lists", {
  id: text("id").primaryKey(),
  firebaseUid: text("firebase_uid").notNull(),
  name: text("name").notNull(),
  projectPostcode: text("project_postcode").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("draft"),
  submittedAt: text("submitted_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("installer_product_lists_owner_idx").on(table.firebaseUid, table.status, table.updatedAt),
]);

export const installerProductListItems = sqliteTable("installer_product_list_items", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  productId: text("product_id").notNull(),
  supplierUid: text("supplier_uid").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCentsExGst: integer("unit_price_cents_ex_gst").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("installer_product_list_items_unique_idx").on(table.listId, table.productId),
  index("installer_product_list_items_list_idx").on(table.listId),
  index("installer_product_list_items_supplier_idx").on(table.supplierUid, table.updatedAt),
]);

export const supplierProductEnquiries = sqliteTable("supplier_product_enquiries", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  installerUid: text("installer_uid").notNull(),
  supplierUid: text("supplier_uid").notNull(),
  status: text("status").notNull().default("new"),
  message: text("message").notNull().default(""),
  supplierNote: text("supplier_note").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("supplier_product_enquiries_list_supplier_idx").on(table.listId, table.supplierUid),
  index("supplier_product_enquiries_supplier_idx").on(table.supplierUid, table.status, table.updatedAt),
  index("supplier_product_enquiries_installer_idx").on(table.installerUid, table.updatedAt),
]);
