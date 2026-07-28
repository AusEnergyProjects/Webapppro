# 08 — Backend, API, Workers and jobs

Audit date: 2026-07-21 (Australia/Sydney)<br>
Audit repository HEAD: `ff3c8efe3d5e501286d8e83e28086d6d4590be27` (documentation-only child)<br>
Application and production source: OpenAI Sites version 199, `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`

## Executive finding

The backend is one Vinext/Cloudflare Worker application. The application source contains **94 route modules and 197 exported HTTP operations**. Snapshot C production Sites version 199 uses exact implementation commit `4a5cd19`, so it packages all 94 modules and 197 operations, including `/api/admin/database` GET/POST/DELETE. Snapshot B production v198 had 93 modules and 194 operations. Snapshot D moved repository HEAD to docs-only child `ff3c8ef` without changing application source or Sites v199. Root, health and legacy redirect were sampled independently; signed-in database-console QA is release-record evidence and other production endpoints were not exercised by this backend audit.

There is no separate API server, OpenAPI document, GraphQL schema, RPC framework, message queue, Durable Object, Workflow, WebSocket service or independent job runner. D1 is accessed directly from route/server helpers with prepared statements. R2 and external providers are also called synchronously from the Worker. The breadth is substantial, but operational reliability is weaker than the product surface: one cron catches failures, provider timeout/retry policy is inconsistent, and no general public-endpoint rate limiter or central request observability contract exists.

## API contract conventions

- Route modules live under `src/app/api/**/route.ts` (the lead route is JavaScript) and export App Router method functions.
- Responses are REST-like JSON, generally `{ ok: boolean, ... }` or `{ ok: false, error: string }`; uploads and downloads use multipart/form-data or binary responses. There is no formal versioned OpenAPI/JSON Schema contract.
- Browser mutations generally use a same-origin check. Firebase bearer tokens establish the user; admin, installer-entitlement, team-role, customer-ownership and capability-token helpers enforce narrower scope.
- Query/body names in the inventory are **statically accepted selectors**, not all unconditionally required. Action-discriminated handlers require different subsets. The route’s validation branches remain the authoritative contract.
- D1 calls use prepared bindings. AST inspection found a direct `db.batch(...)` call in 63 exported operations across 51 route modules; only the statements supplied to one batch are atomic, and no batch can make a D1 plus R2/provider sequence atomic. Action-discriminated handlers do not necessarily execute their batch on every branch.
- The table inventory was produced from the tracked route source. Static SQL extraction can include an occasional SQL keyword captured as a table-like token; the data report is the authoritative physical table inventory.

## Complete endpoint inventory

Source for every row is `src/app/api/<route>/route.*`; `METHOD@line` is the exported handler line in the tracked snapshot. `q`, `b` and `f` mean URL query, JSON body and multipart form fields. “Domain guard” means authorization is performed through a route-specific customer/installer/team/capability helper rather than a literal top-level function name in the static scan.

### Administration

| Route | Operations and accepted selectors | Principal/control | Primary state or side effect |
|---|---|---|---|
| `/api/admin/accounts` | GET@86 `q: cursor,page,pageSize,partnerType,search,sort,status,synthetic,total,uid,verification`; PATCH@193 `b: accountStatus,availabilityStatus,billingStatus,featureGrants,firebaseUid,note,planKey,verificationStatus` | Admin identity; role-sensitive mutations | Accounts, grants, notes, matches, notifications; PATCH batch |
| `/api/admin/admins` | GET@8; POST@19 `b: displayName,email,role`; PATCH@59 `b: id,role,status` | Admin identity; owner invariants | `admin_users` |
| `/api/admin/asset-safety` | GET@68; POST@76 `b: publishNow`; PATCH@102 `b: action,id` | Admin identity | Safety notices; publish/withdraw |
| `/api/admin/asset-transfers` | GET@60; PATCH@68 `b: decision,id,reviewNote` | Admin identity | Ownership transfer and notification batch |
| `/api/admin/database` | GET@113 `q: offset,pageSize,table`; POST@165 `b: confirmation,table,values`; DELETE@188 `b: confirmation,key,table` | Admin; writes require recent owner authentication and typed confirmation | Allowlisted operations; **packaged in production v199**. Release QA made no data mutation. |
| `/api/admin/directory` | GET@65 `q: cursor,page,pageSize,search,sort,status,synthetic,total,type,uid`; PATCH@285 `b: accountStatus,accountType,addressState,displayName,firebaseUid,householdSituation,note,postcode,propertyType` | Admin identity | Customer/trade directory, notes, search |
| `/api/admin/ecosystem-health` | GET@17 | Admin identity | Aggregated D1 counts/readiness |
| `/api/admin/evidence` | GET@15 `q: id` | Admin identity | Authorized R2 evidence download via metadata |
| `/api/admin/form-templates` | GET@62; POST@70 `b: publishNow`; PATCH@97 `b: action,id` | Admin identity | Form templates; publish/withdraw |
| `/api/admin/handover-corrections` | GET@44; PATCH@52 `b: decision,id,reviewNote` | Admin identity | Correction review; asset/event/notification batch |
| `/api/admin/handovers` | GET@14; PATCH@96 `b: decision,id,reviewNote` | Admin identity | Handover/compliance review; multi-table batch |
| `/api/admin/jobs` | GET@6 `q: q` | Admin identity | Job/customer lookup |
| `/api/admin/list-views` | GET@10; PATCH@21; DELETE@35 | Admin identity; helper validates view body | Owner-scoped admin saved views |
| `/api/admin/lookups` | GET@10 `q: q,selected,type` | Admin identity | Accounts/customers/products/opportunities lookup |
| `/api/admin/notifications` | GET@85 `q: assignedTo,category,priority,queue,requiresAction,search,status`; PATCH@202 `b: action,assignedToUid,dueAt,id,note,priority` | Admin identity | Inbox, audit log and delivery state; PATCH batch |
| `/api/admin/opportunities` | GET@50 `q: cursor,page,pageSize,search,service,sort,state,status,synthetic,total`; POST@128 `b: postcode,priority,projectType,serviceCategories,state,status,summary,timing,title`; PATCH@160 `b: id,status` | Admin identity | Opportunities, search and matches |
| `/api/admin/opportunities/allocate` | POST@6 `b: opportunityId` | Admin identity | Allocation helper; multi-table domain transaction |
| `/api/admin/opportunities/matches` | POST@29 `b: adminNote,firebaseUid,opportunityId`; PATCH@202 `b: adminNote,id,status` | Admin identity | Installer match creation/status |
| `/api/admin/performance` | GET@19 | Admin identity | `api_performance_samples` |
| `/api/admin/product-enquiries` | GET@12 `q: search,status` | Admin identity | Product-list/enquiry reporting |
| `/api/admin/products` | GET@39 `q: brand,category,cursor,listing,maxPrice,minPrice,model,page,pageSize,review,search,sort,stock,supplier,synthetic,total`; PATCH@121 `b: id,listingStatus,reviewNote,reviewStatus` | Admin identity | Catalogue search/review and notifications |
| `/api/admin/recovery` | POST@14 | Firebase identity plus recovery policy | Restore an eligible admin account state |
| `/api/admin/referrals` | GET@14; PATCH@54 `b: action,id,note` | Admin identity | Referral/credit review and notifications |
| `/api/admin/service-follow-up-reporting` | GET@11 | Admin identity | Reminder/follow-up aggregate reporting |
| `/api/admin/service-reminder-delivery` | GET@52; PATCH@58 `b: channel,dailyLimit,enabled,expectedRevision,senderLabel`; POST@81 `b: action,deliveryId` | Admin identity | Channel configuration and deliberate retry dispatch |
| `/api/admin/session` | GET@19; POST@91 `b: code` | Firebase identity; admin activation/session controls | Admin record/audit plus dashboard summary |
| `/api/admin/usability-pilot` | GET@89; POST@95 `b: action,baselineSystem,confidenceScore,durationMinutes,easeScore,feedback,firebaseUid,nextAction,observedFrictions,ownerUid,participantId,pilotId,primaryTrade,scheduledAt,sessionType,slotNumber,status,tasksAttempted,tasksCompleted,teamSize`; PATCH@172 `b: action,baselineSystem,endsAt,nextAction,ownerUid,participantId,pilotId,primaryTrade,startsAt,status,teamSize` | Admin identity | Pilot, participant and session records |

### Public, customer, catalogue and provider callback routes

| Route | Operations and accepted selectors | Principal/control | Primary state or side effect |
|---|---|---|---|
| `/api/certificate-prices` | GET@6 | Public | Reads cached D1 price history and may refresh a stale feed; public cache headers |
| `/api/customer-account` | GET@30; POST@67 | Firebase customer guard; POST body parsed by domain helper | Customer account and consent records |
| `/api/customer-appointment-rescheduling` | GET@92; POST@98 `b: accessNotes,appointmentId,expectedAppointmentRevision,preferredWindows,reason` | Customer/project authorization | Reschedule request, revision and events |
| `/api/customer-asset-lifecycle` | GET@134 `q: packId,projectId`; PATCH@145 `b: action,assetId,code,emailEnabled,enabled,leadDays,mobile,noticeId,packId,projectId,smsEnabled` | Customer/ownership guard | Preferences, contacts, opt-outs, safety acknowledgements |
| `/api/customer-asset-ownership` | GET@138; POST@146 `b: action,claimCode,consent,handoverPackId`; PATCH@238 `b: transferId` | Customer identity and ownership/claim checks | Ownership claims and transfer workflow |
| `/api/customer-project-evidence` | GET@102 `q: download,projectId`; POST@140 `f: category,clientUploadId,file,projectId`; DELETE@206 `q: id` | Customer/project authorization | R2 evidence plus D1 metadata/event ledger |
| `/api/customer-projects` | GET@283; POST@294; PATCH@334 | Customer guard; action-specific body helper | Projects, quotes, contact release, arrivals and matches |
| `/api/customer-trade-quotes` | GET@83; POST@89 `b: consentConfirmed,decision,quoteVersionId,selectedChoiceIds` | Customer/project guard | Accepted quote/handoff/job event batch |
| `/api/direct-trade-billing` | GET@12 `q: action,cadence,email,partnerType,uid` | Signed/validated direct-billing flow | Redirects to configured Stripe-hosted membership links/portal |
| `/api/electricity-plans` | GET@34 `q: customerType,postcode` | Public | Fetches official retailer CDR product APIs; response caching |
| `/api/gas-plans` | GET@35 `q: annualMj,includeConditional,postcode,usageProfile`; optional JSON `source` | Public | Fetches/normalizes gas plan feeds; response caching |
| `/api/health` | GET@5 | Public | Constant service health response; no dependency health check |
| `/api/internal/lead-webhook-probe` | POST@33 | Bearer operational secret and signed probe contract | Calls configured Apps Script webhook; no CRM record mutation |
| `/api/job-information/[token]` | GET@138; POST@145 `b: action,checklistVersion,confirmed` or `f: checklistVersion,confirmClarity,confirmPrivacy,confirmRelevance,file,requirementId`; DELETE@260 `q: id` | Expiring capability token | Customer job info, sanitized photo upload/review/delete, R2 + D1 events |
| `/api/leads` | POST@57 | Public; validation, honeypot and durable hashed-client limit | Forwards normalized lead to Apps Script; five attempts/hour/client |
| `/api/product-marketplace` | GET@125 `q: brand,category,cursor,facets,maxLead,maxPrice,minPrice,minWarranty,model,page,pageSize,search,sort,state,stock,supplier,total` | Firebase identity | Product/search/preferences-filtered catalogue |
| `/api/product-marketplace/preferences` | GET@106; PATCH@115; DELETE@168 | Installer/domain guard | Catalogue preferences |
| `/api/product-marketplace/supplier` | GET@15 `q: supplierUid` | Firebase identity | Supplier profile/locations/products |
| `/api/product-selections` | GET@97; POST@107 `b: action,listId,message,name,notes,productId,projectPostcode,quantity`; PATCH@204 `b: action,itemId,listId,quantity` | Installer/domain guard | Lists, items and supplier enquiries |
| `/api/quote-review/[token]` | GET@70; POST@80 `b: action,consentConfirmed,decision,question,selectedChoiceIds,signerName` | Expiring capability token | Quote questions, decisions, choices and commercial handoff |
| `/api/service-reminder-provider-events/resend` | POST@11 | Resend/Svix signature | Idempotent email delivery event reconciliation across reminder/appointment/photo/quote ledgers |
| `/api/service-reminder-provider-events/twilio` | POST@14 | Twilio signature | SMS status and STOP/opt-out reconciliation; idempotent event key |
| `/api/square/webhook` | POST@33 | Square HMAC signature and canonical notification URL | Payment reconciliation ledger |
| `/api/stripe/webhook` | POST@336 | Stripe signature; two accepted signing secrets; replay table | Membership/referral/payment reconciliation |
| `/api/supplier-enquiries` | GET@76; PATCH@86 `b: id,status,supplierNote` | Supplier account guard | Supplier enquiry state |
| `/api/supplier-locations` | GET@18; POST@24 `b: action,addressLine1,addressState,contactNumber,dispatchNotes,id,locationName,locationType,postcode,salesEmail,serviceStates,suburb` | Supplier account guard | Supplier location CRUD-style actions |
| `/api/supplier-products` | GET@445 `q: cursor,mode,q,selected`; POST@475 `b: dependencies,products`; PATCH@758 `b: dependencies,id` | Supplier account guard | Product import/create/update, links and dependencies |
| `/api/tlink-search` | GET@31 `q: kind,q` | Firebase identity | Cross-domain search over jobs, contacts, products, POs and team |

### Trade, CRM, field and integration routes

| Route | Operations and accepted selectors | Principal/control | Primary state or side effect |
|---|---|---|---|
| `/api/trade-accounting` | GET@619 `q: invoiceSource,provider,workOrderId`; POST@651 `b: accountReference,action,invoiceSource,provider,workOrderId` | Installer operations | Xero/MYOB/QuickBooks export/status; accounting documents/events |
| `/api/trade-address-suggestions` | GET@18 `q: query` | Installer operations | Calls configurable provider; honest manual-entry fallback |
| `/api/trade-asset-lifecycle` | GET@155 `q: workOrderId`; POST@166 `b: action,assetId,autoCreateEnabled,cadenceMonths,jobLeadDays,jobTemplateId,nextDueAt,planId,providerReference,serviceType,servicedAt,summary,workOrderId`; PATCH@250 `b: nextDueAt,planId,status,workOrderId` | Installer/domain guard | Service plans/events and generated jobs |
| `/api/trade-assets` | GET@174 `q: category,customerId,search,siteId,status,warranty`; POST@197 `b: action,assetCategory,assetId,assetLabel,brand,commissioningReference,customerId,installedAt,modelNumber,quantity,serialNumber,serviceSiteId,warrantyEnd,warrantyProvider,warrantyReference,warrantyStart`; PATCH@246 `b: assetId,assetLabel,assetStatus,commissioningReference,serialNumber,serviceSiteId,warrantyEnd,warrantyProvider,warrantyReference,warrantyStart` | Installer/domain guard | Installed assets and job events |
| `/api/trade-calendar-sync` | GET@32; POST@40 `b: weekStart` | Installer operations | One-way Google/Microsoft calendar mirror; D1 external-event records |
| `/api/trade-commercial-handoff` | GET@85 `q: workOrderId`; POST@94 `b: depositKind,value,workOrderId` | Installer operations | Commercial handoff and payment-link preparation |
| `/api/trade-crm` | GET@689 `q: cursor,id,mode,resource`; POST@718 `b: action` plus customer/contact/site/job/appointment/note/task/quick-invoice fields; PATCH@1189 `b: action` plus record IDs, contact/site/job/stage/status/financial fields | Installer/domain guard | Central CRM command route; many action-specific D1 batches |
| `/api/trade-enquiries` | GET@68 `q: id,search,source,status`; POST@100 `b: action,channel,customerId,direction,duplicateDecision,enquiryId,lostReason,message,sourceType,status` | Installer/domain guard | Enquiry, message, attachment, duplicate and conversion state |
| `/api/trade-field-work` | GET@212 `q: download,preview,workOrderId`; POST@279 `b: action,confirmed,durationMinutes,notes,signerName,signerRole,staffLabel,workDate,workOrderId`; DELETE@332 `q: id` | Installer team access | Time, signoff, media and R2 download/delete |
| `/api/trade-handover` | GET@219 `q: workOrderId`; POST@232 `b: action,assetCategory,brand,installedAt,modelNumber,quantity,serialNumber,supplierProductId,warrantyEnd,warrantyProvider,warrantyReference,warrantyStart,workOrderId`; PATCH@323 `b: action,assetId,itemId,status,workOrderId` | Installer/domain guard | Handover packs, installed assets and compliance |
| `/api/trade-handover/documents` | GET@71 `q: download`; POST@110 `f: category,customerVisible,file,workOrderId`; DELETE@174 `q: id,workOrderId` | Installer/admin domain guard | R2 handover documents plus events |
| `/api/trade-handover-corrections` | GET@81 `q: workOrderId`; POST@92 `b: assetId,fieldKey,proposedValue,reason,workOrderId` | Installer/domain guard | Correction request and work-order event |
| `/api/trade-imports` | GET@157 `q: batchId`; POST@177 `b: action,batchId,csvText,fileName,fileSizeBytes,importType`; PATCH@352 `b: action,batchId,resolution,rowId` | Installer/domain guard | Staged CSV imports, row validation/resolution and commit batches |
| `/api/trade-integrations` | GET@43; POST@71 `b: provider,weekStart`; PATCH@184 `b: provider` | Installer operations | OAuth start/manual sync/disconnect and best-effort revocation |
| `/api/trade-integrations/callback/[provider]` | GET@187 `q: code,error,state` | One-time OAuth state plus provider callback | Exchanges token, stores encrypted credentials/metadata, redirects |
| `/api/trade-invoices` | GET@17 | Installer operations | Invoice home aggregation from authoritative TLink records |
| `/api/trade-job-forms` | GET@71 `q: workOrderId`; POST@80 `b: templateKey,templateVersion,workOrderId`; PATCH@122 `b: answers,baseRevision,complete,formId,workOrderId` | Installer/domain guard | Versioned job forms and service/job events |
| `/api/trade-job-notifications` | GET@181; PATCH@189 `b: notificationKey` | Installer team access | Derived notifications and per-member read receipts |
| `/api/trade-job-packets` | GET@67 `q: serviceCategory`; POST@84 `b: action`; PATCH@109 `b: action,packetId` | Team access; manager for mutation | Packet/item/form/template composition |
| `/api/trade-job-readiness` | GET@100 `q: workOrderId`; POST@114 `b: action,durationMinutes,note,quantityMilli,requirement,requirementId,status,totalCostCents,usePlanned,workOrderId` | Installer operations | Accepted-quote snapshot, job plan/actual/readiness events |
| `/api/trade-list-views` | GET@38; POST@50; PATCH@64; DELETE@80 | Installer/domain guard; helper-validated body | Owner-scoped saved list views |
| `/api/trade-opportunities` | GET@76; PATCH@237 `b: action,expectedRevision,installerNote,matchId,status,windows` | Installer/domain guard | Opportunity match/acceptance, contact release and arrivals |
| `/api/trade-payment-links` | POST@163 `b: provider,purpose,workOrderId` | Installer operations | Stripe/Square checkout link creation/reuse; D1 payment ledger |
| `/api/trade-photo-requests` | GET@196 `q: workOrderId`; POST@206 `b: action,channel,consentConfirmed,deliveryId,deliveryIntent,expectedRevision,reasonCode,requirementId,requirements,reviewRevision,reviewStatus,sourceTemplateVersionId,templateFeedback,templateMissingFeedback,workOrderId`; DELETE@382 `q: workOrderId` | Installer team access | Requirement/review/delivery ledger; Resend/Twilio sends |
| `/api/trade-photo-templates` | GET@200; POST@209 `b: action,name,templateId` | Team access; manager for mutation | Versioned templates |
| `/api/trade-price-book` | GET@119 `q: itemId`; POST@139 `b: action`; PATCH@171 `b: action,itemId` | Team access; manager for mutation | Price-book item/history batches |
| `/api/trade-profile` | GET@79; PATCH@153; POST@211 | Installer/supplier domain guard; form/body helpers | Trade account, membership, grants and referral code |
| `/api/trade-purchasing` | GET@171 `q: cursor`; POST@182 `b: action,deliveryMethod,deliveryNotes,enquiryId,installerReference,issueCategory,itemId,orderId,serialNumber,summary`; PATCH@275 `b: action,claimId,expectedAt,itemQuantities,orderId,resolution,status,supplierNote,supplierReference,supplierResponse` | Installer/domain guard | Purchase orders, items, events and warranty claims |
| `/api/trade-quick-invoices` | GET@87 `q: workOrderId`; POST@98 `b: action,consentConfirmed,description,dueAt,expectedRevision,invoiceId,lines,reason,subtotalCents,taxCode` | Installer operations | Versioned invoice/credit/payment-allocation ledger |
| `/api/trade-quotes` | GET@178 `q: workOrderId`; POST@190 `b: action,answer,channel,choices,consentConfirmed,customerEmail,lines,questionId,terms,validUntil,workOrderId` | Installer/domain guard | Versioned quote, secure link, question, delivery and execution snapshot |
| `/api/trade-referrals` | GET@113; POST@124 | Installer/domain guard; helper parses body | Referral code and Stripe referral updates |
| `/api/trade-schedule` | GET@149; PATCH@159 `b: action,appointmentId,decision,decisionNote,durationMinutes,endMinute,endsAt,expectedAppointmentRevision,expectedRequestRevision,expectedRevision,id,isAvailable,memberId,rangeStart,rangeWeeks,reason,requestId,startMinute,startsAt,weekStart,weekday,workOrderId` | Installer team access | Availability, appointments, rescheduling and events |
| `/api/trade-service-follow-ups` | GET@141; PATCH@232 `b: action,channel,dueAt,expectedRevision,internalNotes,memberId,servicePlanId,suppressionReason` | Installer team access | Follow-up assignment/status/event ledger and delivery |
| `/api/trade-team` | GET@88; POST@96 `b: action,displayName,email,memberId,role,token`; PATCH@204 `b: action,memberId,role,stage,status,taskId,workOrderId` | Firebase/team access; role-dependent actions | Team/invite/job/task/event state |
| `/api/trade-team/devices` | GET@76 `q: platform`; POST@87 `b: appVersion,deviceId,deviceName,platform,pushProvider,pushToken`; PATCH@132 `b: action,id,pushProvider,pushToken` | Team access | Device registration/revocation and upload cleanup |
| `/api/trade-team/media` | GET@253 `q: deviceId,sessionId`; POST@269 `b/f: action` plus multipart headers/part payload; DELETE@291 `q: deviceId,sessionId` | Team access plus registered device | R2 multipart create/upload/complete/abort and D1 session ledger |
| `/api/trade-team/sync` | GET@188 `q: appVersion,cursor,deviceId,limit,platform`; POST@556 `b: actions,appVersion,deviceId,platform` | Team access plus registered device | Contract-v3 changes and idempotent offline action receipts |
| `/api/trade-verification/documents` | GET@74 `q: download`; POST@111 `f: category,expiryDate,file`; DELETE@186 `q: id` | Installer/domain guard | R2 verification evidence plus D1 metadata |
| `/api/trade-work-orders` | GET@281; POST@291 `b: action,assigneeLabel,dueAt,priority,scheduledEnd,scheduledStart,serviceCategory,siteArea,sourceReference,sourceType,title,workOrderId`; PATCH@454 `b: action,assigneeLabel,priority,scheduledEnd,scheduledStart,stage,status,taskId,workOrderId` | Installer/domain guard | Work order conversion, task/state/appointment/handover batches |

## Complete operation-class disposition

| Required interface class | Discovered operations | Complete disposition |
|---|---:|---|
| REST-like HTTP | 197 exported App Router method operations across 94 unique route modules | Every operation is in the route tables and normalized mapping below; no duplicate route-module path or duplicate exported method was found |
| GraphQL | 0 | `NOT APPLICABLE`; no schema, resolver, GraphQL dependency or endpoint was found |
| RPC | 0 | `NOT APPLICABLE`; no RPC framework, procedure registry or transport was found. Action-discriminated REST bodies are not relabelled RPC |
| WebSocket | 0 | `NOT APPLICABLE`; no upgrade handler, socket server/client or WebSocket dependency was found |
| Webhook | 5 receive surfaces | Four signed provider callback operations are included in the 197 HTTP mapping (Stripe, Square, Resend and Twilio); Apps Script `doPost` is the fifth and is N05 below |
| Worker | 2 entry events | Worker `fetch` and the cron `scheduled` dispatcher are N01-N02 below; the two dispatched jobs are N03-N04 |
| Scheduled/background | 5 named jobs plus their dispatch/registration controls | Worker jobs N03-N04, Apps Script jobs N09-N10 and Expo task N11; Worker dispatch is N02, Apps trigger installers N07-N08 and Expo registration controls N12-N13 |
| Queue | 0 server queue/broker consumers | `NOT APPLICABLE` currently. D1 delivery ledgers and mobile local queues are not autonomous server queues |
| CLI | 23 tracked executable command interfaces | Fourteen root npm scripts, eight mobile npm scripts and the direct synthetic-population command are normalized in the CLI register below. The compatibility loader is import-only, not a CLI |
| Administrative operations | 53 `/api/admin/*` operations, one shared protected handover-document GET consumed by the admin UI, plus two Apps Script trigger installers | The 53 admin-namespace operations and shared `GET /api/trade-handover/documents` produce 54 `ADM` consumer classifications in the 197 mapping; `setup` and `setupOperationalMonitoring` are N07-N08. Generic Database Console risk is reviewed in report 13 |

## Per-operation contract resolution

The three route tables above and the mapping below form one normalized 197-operation register. They must be joined by the exact route plus `METHOD@line`; no row may be read in isolation. Resolution precedence is: (1) the exact operation row below, (2) the matching method selectors, principal/control and state/effect in the route table above, then (3) the code definition below. A missing selector or control is recorded as not formally specified or `UNKNOWN`, never silently treated as empty, safe or healthy.

| Required field | Deterministic resolution for every mapped operation |
|---|---|
| Protocol/method | `HTTPS` plus the method in **Operation**. These are Vinext App Router HTTP operations; no GraphQL, RPC or WebSocket operation was found. |
| Route or event | Exact path in **Operation**. All non-App-Router events and commands are registered separately as N01-N13; the five named jobs are N03, N04, N09, N10 and N11. |
| Implementation symbol | Exact tracked `route.ts`/`route.js` path and exported method line in **Symbol**. |
| Callers/consumers | **Callers/consumers** code set below. A `+`-delimited value records every source-evidenced web, mobile, provider or operational consumer class for that exact method. Historical intent is retained only where the orphan ledger explicitly says no current caller exists. |
| Authentication and authorization | The matching route table's **Principal/control** cell, narrowed by method wording such as “manager for mutation.” Consumer-class codes do not replace the actual guard. |
| Request schema | **Contract** input code plus the exact `q:`, `b:` or `f:` selectors beside that method above. `SRC` with no selector list means source/helper-defined and not formally specified, not “no input.” |
| Response schema | **Contract** response code. `JSON` means the observed REST-like `{ ok, ... }` / `{ ok: false, error }` family; there is no stable machine-readable response schema. Binary and redirect exceptions are explicit. |
| Validation | **Contract** validation code plus the matching guard/parser in source. `ROUTE` means action/field branches are authoritative because no JSON Schema/OpenAPI validator exists. |
| Storage touched | First code in **State/integration/effect**, refined by the named records/effects in the matching route row. `D1+R2` means an operation may touch both; it does not claim cross-resource atomicity. |
| External integrations | Second code in **State/integration/effect**. Firebase identity verification is recorded under authentication, not repeated as a business integration. |
| Side effects | Third code in **State/integration/effect** plus the route row's named effect. `WRITE+CALL` distinguishes provider calls from D1-only writes. |
| Transactions | First **Controls** code. `TXB` was derived from the exported function AST, not from a filename-level text match. |
| Idempotency | Second **Controls** code. `IDP` means only named action branches are protected; it is not an operation-wide guarantee. |
| Pagination/filtering/sorting | Exact `q:` selectors for that method. Named cursor/page/pageSize/search/sort/filter selectors apply; for POST/PATCH without `q:` this is `NOT APPLICABLE`; for GET/DELETE with no normalized `q:` list it remains `UNKNOWN` because helper parsing may exist. |
| Caching | Fourth **Controls** code. All `/api/*` paths bypass the Worker's HTML cache; only explicit route response policies upgrade `C0`. |
| Concurrency | Third **Controls** code. `CC1` is limited to explicit revision/state/lease comparison, not database-wide locking. |
| Retry and timeout | Fifth **Controls** code. Manual retry actions are separated from automatic network retry. |
| Rate limiting | Sixth **Controls** code. Provider quotas are external and remain `UNKNOWN`. |
| Tests | First **Evidence** code. A route-level static test reference does not prove that each mapped method or action branch executed. |
| Documentation | Second **Evidence** code. This report plus source is the contract record; no OpenAPI/GraphQL/RPC schema exists. |
| Deployment evidence | Third **Evidence** code, always tied to Sites v199 source `4a5cd19`; final repository `ff3c8ef` is documentation-only. |
| Current status | Final **Evidence** code using the shared taxonomy and separating packaged deployment from current behavior. |

### Profile codes

| Code family | Codes and exact meaning |
|---|---|
| Callers/consumers | `ADM` admin/owner UI; `CUS` signed-in customer UI; `BIL` signed billing link; `PUB` unauthenticated public client; `OPS` private operational monitor; `CAP` holder of an expiring capability link; `WH` external provider webhook; `SUP` supplier UI; `TRD` installer/trade UI; `OAU` OAuth provider callback; `MOB` registered field-device client. Multiple known classes are joined with `+`; tests statically reference, but do not necessarily execute, every `T1` route. |
| Input | `SRC` exact method selectors above or source/helper-defined schema; `FORM` multipart form; `JSON+FORM` action-discriminated JSON or multipart; `RAW` provider-signed raw request. |
| Response | `JSON` REST-like JSON family; `JSON+BIN` JSON or authorized binary stream; `REDIRECT` HTTP redirect. |
| Validation | `ROUTE` inline/helper action and field validation; `UPLOAD` upload size/type/signature and route authorization; `SIG` provider signature plus event validation; `CAP` capability-token expiry/scope plus action validation; `OAUTH` allowlisted provider and one-time state; `LEAD` normalization, honeypot and lead-specific abuse validation. |
| Storage | `S0` no D1/R2 application storage touched; `D1` D1 read/write; `D1+R2` D1 metadata/state plus R2 object or multipart state. |
| Integration | `I0` no business-provider call evidenced; `CERT` certificate-price feed; `PLAN` retailer/gas plan sources; `LEAD` Apps Script lead relay; `STRIPE`; `SQUARE`; `MSG` Resend/Twilio delivery; `ACCT` Xero/MYOB/QuickBooks adapter; `ADDR` configured address provider; `CAL` Google/Microsoft calendar OAuth/sync; `PAY` Stripe/Square checkout adapter. |
| Effect | `READ`; `WRITE`; `CALL`; `READ+BIN`; `FILE+WRITE`; `WRITE+CALL`; `READ+WRITE+CALL`; `REDIRECT`; `WRITE+REDIRECT`; `RECON` provider-event reconciliation. |
| Transaction | `TXNA` read/no transaction applicable; `TXB` direct D1 batch in the exported handler; `TXH` batch/transaction behavior is owned by a called domain helper and its exact scope must be read there; `TX0` no operation-wide atomic boundary evidenced. D1/R2/provider work is never jointly atomic. |
| Idempotency | `IDNA` pure read; `ID1` explicit operation-level key/replay/deduplication; `IDP` only some action branches; `ID0` no operation-wide idempotency contract evidenced. |
| Concurrency | `CCNA` read-only; `CC1` one or more explicit revision/state/lease comparisons in the operation's action branches; `CC0` no explicit optimistic-concurrency contract evidenced. `CC1` is not an operation-wide guarantee unless every branch enforces it. |
| Cache | `C0` API excluded from Worker HTML cache, no stronger route contract; `CN` explicit private/no-store; `CP` explicit public cache/stale-while-revalidate. |
| Retry/timeout | `RT0` no explicit automatic retry or outbound timeout; `RT4` four-second outbound timeout, no automatic retry; `RT10` ten-second outbound timeout, no automatic retry; `RTM` bounded deliberate/manual retry action, no general automatic retry and no general outbound timeout. |
| Rate | `RL0` no route-level request limiter evidenced; `RL5` durable five-per-hour client limit; `RL2` at most two deliberate resends for the protected delivery branch; `RLD` configured daily provider-send limit. |
| Test/docs | `T1` at least one static test reference to the route module, without method/action coverage proof; `T0` no static route-module test reference; `D0` source plus this audit only, with no formal machine-readable API contract. |
| Deployment/current status | `E1` exact route source packaged in Sites v199 from `4a5cd19`; `E2` E1 plus dated public `/api/health` sampling; `E3` E1 plus release-record signed-in Database Console QA. The final value is an exact shared-taxonomy literal: `VERIFIED DEPLOYED`, `PARTIAL` or `UNKNOWN`. Deployment provenance remains separate and does not upgrade unexercised operation behavior. |

### Explicit 197-operation mapping

Column order is fixed: **Contract** = input/response/validation; **State/integration/effect** = storage/integration/side effect; **Controls** = transaction/idempotency/concurrency/cache/retry-timeout/rate; **Evidence** = tests/docs/deployment/current status.

| # | Operation | Symbol | Callers/consumers | Contract | State/integration/effect | Controls | Evidence |
|---:|---|---|---|---|---|---|---|
| 1 | `GET /api/admin/accounts` | `src/app/api/admin/accounts/route.ts:86` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 2 | `PATCH /api/admin/accounts` | `src/app/api/admin/accounts/route.ts:193` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 3 | `GET /api/admin/admins` | `src/app/api/admin/admins/route.ts:8` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 4 | `POST /api/admin/admins` | `src/app/api/admin/admins/route.ts:19` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 5 | `PATCH /api/admin/admins` | `src/app/api/admin/admins/route.ts:59` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 6 | `GET /api/admin/asset-safety` | `src/app/api/admin/asset-safety/route.ts:68` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 7 | `POST /api/admin/asset-safety` | `src/app/api/admin/asset-safety/route.ts:76` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 8 | `PATCH /api/admin/asset-safety` | `src/app/api/admin/asset-safety/route.ts:102` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 9 | `GET /api/admin/asset-transfers` | `src/app/api/admin/asset-transfers/route.ts:60` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 10 | `PATCH /api/admin/asset-transfers` | `src/app/api/admin/asset-transfers/route.ts:68` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 11 | `GET /api/admin/database` | `src/app/api/admin/database/route.ts:113` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E3/PARTIAL |
| 12 | `POST /api/admin/database` | `src/app/api/admin/database/route.ts:165` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E3/UNKNOWN |
| 13 | `DELETE /api/admin/database` | `src/app/api/admin/database/route.ts:188` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E3/UNKNOWN |
| 14 | `GET /api/admin/directory` | `src/app/api/admin/directory/route.ts:65` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 15 | `PATCH /api/admin/directory` | `src/app/api/admin/directory/route.ts:285` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 16 | `GET /api/admin/ecosystem-health` | `src/app/api/admin/ecosystem-health/route.ts:17` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 17 | `GET /api/admin/evidence` | `src/app/api/admin/evidence/route.ts:15` | ADM | SRC/JSON+BIN/ROUTE | D1+R2/I0/READ+BIN | TXNA/IDNA/CCNA/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 18 | `GET /api/admin/form-templates` | `src/app/api/admin/form-templates/route.ts:62` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 19 | `POST /api/admin/form-templates` | `src/app/api/admin/form-templates/route.ts:70` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 20 | `PATCH /api/admin/form-templates` | `src/app/api/admin/form-templates/route.ts:97` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 21 | `GET /api/admin/handover-corrections` | `src/app/api/admin/handover-corrections/route.ts:44` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 22 | `PATCH /api/admin/handover-corrections` | `src/app/api/admin/handover-corrections/route.ts:52` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 23 | `GET /api/admin/handovers` | `src/app/api/admin/handovers/route.ts:14` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 24 | `PATCH /api/admin/handovers` | `src/app/api/admin/handovers/route.ts:96` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 25 | `GET /api/admin/jobs` | `src/app/api/admin/jobs/route.ts:6` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 26 | `GET /api/admin/list-views` | `src/app/api/admin/list-views/route.ts:10` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 27 | `PATCH /api/admin/list-views` | `src/app/api/admin/list-views/route.ts:21` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 28 | `DELETE /api/admin/list-views` | `src/app/api/admin/list-views/route.ts:35` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 29 | `GET /api/admin/lookups` | `src/app/api/admin/lookups/route.ts:10` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 30 | `GET /api/admin/notifications` | `src/app/api/admin/notifications/route.ts:85` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 31 | `PATCH /api/admin/notifications` | `src/app/api/admin/notifications/route.ts:202` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 32 | `GET /api/admin/opportunities` | `src/app/api/admin/opportunities/route.ts:50` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 33 | `POST /api/admin/opportunities` | `src/app/api/admin/opportunities/route.ts:128` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 34 | `PATCH /api/admin/opportunities` | `src/app/api/admin/opportunities/route.ts:160` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 35 | `POST /api/admin/opportunities/allocate` | `src/app/api/admin/opportunities/allocate/route.ts:6` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXH/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 36 | `POST /api/admin/opportunities/matches` | `src/app/api/admin/opportunities/matches/route.ts:29` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 37 | `PATCH /api/admin/opportunities/matches` | `src/app/api/admin/opportunities/matches/route.ts:202` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 38 | `GET /api/admin/performance` | `src/app/api/admin/performance/route.ts:19` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 39 | `GET /api/admin/product-enquiries` | `src/app/api/admin/product-enquiries/route.ts:12` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 40 | `GET /api/admin/products` | `src/app/api/admin/products/route.ts:39` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 41 | `PATCH /api/admin/products` | `src/app/api/admin/products/route.ts:121` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 42 | `POST /api/admin/recovery` | `src/app/api/admin/recovery/route.ts:14` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 43 | `GET /api/admin/referrals` | `src/app/api/admin/referrals/route.ts:14` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 44 | `PATCH /api/admin/referrals` | `src/app/api/admin/referrals/route.ts:54` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 45 | `GET /api/admin/service-follow-up-reporting` | `src/app/api/admin/service-follow-up-reporting/route.ts:11` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 46 | `GET /api/admin/service-reminder-delivery` | `src/app/api/admin/service-reminder-delivery/route.ts:52` | ADM | SRC/JSON/ROUTE | D1/MSG/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 47 | `PATCH /api/admin/service-reminder-delivery` | `src/app/api/admin/service-reminder-delivery/route.ts:58` | ADM | SRC/JSON/ROUTE | D1/MSG/WRITE | TX0/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 48 | `POST /api/admin/service-reminder-delivery` | `src/app/api/admin/service-reminder-delivery/route.ts:81` | ADM | SRC/JSON/ROUTE | D1/MSG/WRITE+CALL | TX0/ID0/CC0/C0/RTM/RLD | T1/D0/E1/UNKNOWN |
| 49 | `GET /api/admin/session` | `src/app/api/admin/session/route.ts:19` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 50 | `POST /api/admin/session` | `src/app/api/admin/session/route.ts:91` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 51 | `GET /api/admin/usability-pilot` | `src/app/api/admin/usability-pilot/route.ts:89` | ADM | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 52 | `POST /api/admin/usability-pilot` | `src/app/api/admin/usability-pilot/route.ts:95` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 53 | `PATCH /api/admin/usability-pilot` | `src/app/api/admin/usability-pilot/route.ts:172` | ADM | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 54 | `GET /api/certificate-prices` | `src/app/api/certificate-prices/route.ts:6` | PUB | SRC/JSON/ROUTE | D1/CERT/READ+WRITE+CALL | TXH/ID0/CCNA/CP/RT0/RL0 | T0/D0/E1/UNKNOWN |
| 55 | `GET /api/customer-account` | `src/app/api/customer-account/route.ts:30` | CUS | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 56 | `POST /api/customer-account` | `src/app/api/customer-account/route.ts:67` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 57 | `GET /api/customer-appointment-rescheduling` | `src/app/api/customer-appointment-rescheduling/route.ts:92` | CUS | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 58 | `POST /api/customer-appointment-rescheduling` | `src/app/api/customer-appointment-rescheduling/route.ts:98` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 59 | `GET /api/customer-asset-lifecycle` | `src/app/api/customer-asset-lifecycle/route.ts:134` | CUS | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 60 | `PATCH /api/customer-asset-lifecycle` | `src/app/api/customer-asset-lifecycle/route.ts:145` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 61 | `GET /api/customer-asset-ownership` | `src/app/api/customer-asset-ownership/route.ts:138` | CUS | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 62 | `POST /api/customer-asset-ownership` | `src/app/api/customer-asset-ownership/route.ts:146` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 63 | `PATCH /api/customer-asset-ownership` | `src/app/api/customer-asset-ownership/route.ts:238` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 64 | `GET /api/customer-project-evidence` | `src/app/api/customer-project-evidence/route.ts:102` | CUS+TRD | SRC/JSON+BIN/ROUTE | D1+R2/I0/READ+BIN | TXNA/IDNA/CCNA/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 65 | `POST /api/customer-project-evidence` | `src/app/api/customer-project-evidence/route.ts:140` | CUS | FORM/JSON/UPLOAD | D1+R2/I0/FILE+WRITE | TXB/ID1/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 66 | `DELETE /api/customer-project-evidence` | `src/app/api/customer-project-evidence/route.ts:206` | CUS | SRC/JSON/ROUTE | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 67 | `GET /api/customer-projects` | `src/app/api/customer-projects/route.ts:283` | CUS | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 68 | `POST /api/customer-projects` | `src/app/api/customer-projects/route.ts:294` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 69 | `PATCH /api/customer-projects` | `src/app/api/customer-projects/route.ts:334` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 70 | `GET /api/customer-trade-quotes` | `src/app/api/customer-trade-quotes/route.ts:83` | CUS | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 71 | `POST /api/customer-trade-quotes` | `src/app/api/customer-trade-quotes/route.ts:89` | CUS | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 72 | `GET /api/direct-trade-billing` | `src/app/api/direct-trade-billing/route.ts:12` | BIL | SRC/REDIRECT/ROUTE | S0/STRIPE/REDIRECT | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 73 | `GET /api/electricity-plans` | `src/app/api/electricity-plans/route.js:34` | PUB | SRC/JSON/ROUTE | S0/PLAN/CALL | TXNA/IDNA/CCNA/CP/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 74 | `GET /api/gas-plans` | `src/app/api/gas-plans/route.ts:35` | PUB | SRC/JSON/ROUTE | S0/PLAN/CALL | TXNA/IDNA/CCNA/CP/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 75 | `GET /api/health` | `src/app/api/health/route.ts:5` | PUB | SRC/JSON/ROUTE | S0/I0/READ | TXNA/IDNA/CCNA/CN/RT0/RL0 | T1/D0/E2/VERIFIED DEPLOYED |
| 76 | `POST /api/internal/lead-webhook-probe` | `src/app/api/internal/lead-webhook-probe/route.js:33` | OPS | SRC/JSON/ROUTE | S0/LEAD/CALL | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 77 | `GET /api/job-information/[token]` | `src/app/api/job-information/[token]/route.ts:138` | CAP | SRC/JSON/CAP | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 78 | `POST /api/job-information/[token]` | `src/app/api/job-information/[token]/route.ts:145` | CAP | JSON+FORM/JSON/CAP | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 79 | `DELETE /api/job-information/[token]` | `src/app/api/job-information/[token]/route.ts:260` | CAP | SRC/JSON/CAP | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 80 | `POST /api/leads` | `src/app/api/leads/route.js:57` | PUB | SRC/JSON/LEAD | D1/LEAD/WRITE+CALL | TX0/ID0/CC0/C0/RT10/RL5 | T1/D0/E1/UNKNOWN |
| 81 | `GET /api/product-marketplace` | `src/app/api/product-marketplace/route.ts:125` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 82 | `GET /api/product-marketplace/preferences` | `src/app/api/product-marketplace/preferences/route.ts:106` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 83 | `PATCH /api/product-marketplace/preferences` | `src/app/api/product-marketplace/preferences/route.ts:115` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 84 | `DELETE /api/product-marketplace/preferences` | `src/app/api/product-marketplace/preferences/route.ts:168` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 85 | `GET /api/product-marketplace/supplier` | `src/app/api/product-marketplace/supplier/route.ts:15` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 86 | `GET /api/product-selections` | `src/app/api/product-selections/route.ts:97` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 87 | `POST /api/product-selections` | `src/app/api/product-selections/route.ts:107` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 88 | `PATCH /api/product-selections` | `src/app/api/product-selections/route.ts:204` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 89 | `GET /api/quote-review/[token]` | `src/app/api/quote-review/[token]/route.ts:70` | CAP | SRC/JSON/CAP | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 90 | `POST /api/quote-review/[token]` | `src/app/api/quote-review/[token]/route.ts:80` | CAP | SRC/JSON/CAP | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 91 | `POST /api/service-reminder-provider-events/resend` | `src/app/api/service-reminder-provider-events/resend/route.ts:11` | WH | RAW/JSON/SIG | D1/MSG/RECON | TXB/ID1/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 92 | `POST /api/service-reminder-provider-events/twilio` | `src/app/api/service-reminder-provider-events/twilio/route.ts:14` | WH | RAW/JSON/SIG | D1/MSG/RECON | TXB/ID1/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 93 | `POST /api/square/webhook` | `src/app/api/square/webhook/route.ts:33` | WH | RAW/JSON/SIG | D1/SQUARE/RECON | TX0/ID1/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 94 | `POST /api/stripe/webhook` | `src/app/api/stripe/webhook/route.ts:336` | WH | RAW/JSON/SIG | D1/STRIPE/RECON | TX0/ID1/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 95 | `GET /api/supplier-enquiries` | `src/app/api/supplier-enquiries/route.ts:76` | SUP | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 96 | `PATCH /api/supplier-enquiries` | `src/app/api/supplier-enquiries/route.ts:86` | SUP | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 97 | `GET /api/supplier-locations` | `src/app/api/supplier-locations/route.ts:18` | SUP | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 98 | `POST /api/supplier-locations` | `src/app/api/supplier-locations/route.ts:24` | SUP | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 99 | `GET /api/supplier-products` | `src/app/api/supplier-products/route.ts:445` | SUP | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 100 | `POST /api/supplier-products` | `src/app/api/supplier-products/route.ts:475` | SUP | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 101 | `PATCH /api/supplier-products` | `src/app/api/supplier-products/route.ts:758` | SUP | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 102 | `GET /api/tlink-search` | `src/app/api/tlink-search/route.ts:31` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 103 | `GET /api/trade-accounting` | `src/app/api/trade-accounting/route.ts:619` | TRD | SRC/JSON/ROUTE | D1/ACCT/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 104 | `POST /api/trade-accounting` | `src/app/api/trade-accounting/route.ts:651` | TRD | SRC/JSON/ROUTE | D1/ACCT/WRITE+CALL | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 105 | `GET /api/trade-address-suggestions` | `src/app/api/trade-address-suggestions/route.ts:18` | TRD | SRC/JSON/ROUTE | S0/ADDR/CALL | TXNA/IDNA/CCNA/C0/RT4/RL0 | T1/D0/E1/UNKNOWN |
| 106 | `GET /api/trade-asset-lifecycle` | `src/app/api/trade-asset-lifecycle/route.ts:155` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 107 | `POST /api/trade-asset-lifecycle` | `src/app/api/trade-asset-lifecycle/route.ts:166` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 108 | `PATCH /api/trade-asset-lifecycle` | `src/app/api/trade-asset-lifecycle/route.ts:250` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 109 | `GET /api/trade-assets` | `src/app/api/trade-assets/route.ts:174` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 110 | `POST /api/trade-assets` | `src/app/api/trade-assets/route.ts:197` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 111 | `PATCH /api/trade-assets` | `src/app/api/trade-assets/route.ts:246` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 112 | `GET /api/trade-calendar-sync` | `src/app/api/trade-calendar-sync/route.ts:32` | TRD | SRC/JSON/ROUTE | D1/CAL/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 113 | `POST /api/trade-calendar-sync` | `src/app/api/trade-calendar-sync/route.ts:40` | TRD | SRC/JSON/ROUTE | D1/CAL/WRITE+CALL | TX0/ID0/CC0/C0/RT4/RL0 | T1/D0/E1/UNKNOWN |
| 114 | `GET /api/trade-commercial-handoff` | `src/app/api/trade-commercial-handoff/route.ts:85` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 115 | `POST /api/trade-commercial-handoff` | `src/app/api/trade-commercial-handoff/route.ts:94` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 116 | `GET /api/trade-crm` | `src/app/api/trade-crm/route.ts:689` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 117 | `POST /api/trade-crm` | `src/app/api/trade-crm/route.ts:718` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 118 | `PATCH /api/trade-crm` | `src/app/api/trade-crm/route.ts:1189` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 119 | `GET /api/trade-enquiries` | `src/app/api/trade-enquiries/route.ts:68` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 120 | `POST /api/trade-enquiries` | `src/app/api/trade-enquiries/route.ts:100` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 121 | `GET /api/trade-field-work` | `src/app/api/trade-field-work/route.ts:212` | TRD | SRC/JSON+BIN/ROUTE | D1+R2/I0/READ+BIN | TXNA/IDNA/CCNA/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 122 | `POST /api/trade-field-work` | `src/app/api/trade-field-work/route.ts:279` | TRD | FORM/JSON/UPLOAD | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 123 | `DELETE /api/trade-field-work` | `src/app/api/trade-field-work/route.ts:332` | TRD | SRC/JSON/ROUTE | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 124 | `GET /api/trade-handover` | `src/app/api/trade-handover/route.ts:219` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 125 | `POST /api/trade-handover` | `src/app/api/trade-handover/route.ts:232` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 126 | `PATCH /api/trade-handover` | `src/app/api/trade-handover/route.ts:323` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 127 | `GET /api/trade-handover-corrections` | `src/app/api/trade-handover-corrections/route.ts:81` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 128 | `POST /api/trade-handover-corrections` | `src/app/api/trade-handover-corrections/route.ts:92` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 129 | `GET /api/trade-handover/documents` | `src/app/api/trade-handover/documents/route.ts:71` | ADM+CUS+TRD | SRC/JSON+BIN/ROUTE | D1+R2/I0/READ+BIN | TXNA/IDNA/CCNA/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 130 | `POST /api/trade-handover/documents` | `src/app/api/trade-handover/documents/route.ts:110` | TRD | FORM/JSON/UPLOAD | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 131 | `DELETE /api/trade-handover/documents` | `src/app/api/trade-handover/documents/route.ts:174` | TRD | SRC/JSON/ROUTE | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 132 | `GET /api/trade-imports` | `src/app/api/trade-imports/route.ts:157` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 133 | `POST /api/trade-imports` | `src/app/api/trade-imports/route.ts:177` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 134 | `PATCH /api/trade-imports` | `src/app/api/trade-imports/route.ts:352` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 135 | `GET /api/trade-integrations` | `src/app/api/trade-integrations/route.ts:43` | TRD | SRC/JSON/ROUTE | D1/CAL/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 136 | `POST /api/trade-integrations` | `src/app/api/trade-integrations/route.ts:71` | TRD | SRC/JSON/ROUTE | D1/CAL/WRITE+CALL | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 137 | `PATCH /api/trade-integrations` | `src/app/api/trade-integrations/route.ts:184` | TRD | SRC/JSON/ROUTE | D1/CAL/WRITE+CALL | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 138 | `GET /api/trade-integrations/callback/[provider]` | `src/app/api/trade-integrations/callback/[provider]/route.ts:187` | OAU | SRC/REDIRECT/OAUTH | D1/CAL/WRITE+REDIRECT | TX0/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 139 | `GET /api/trade-invoices` | `src/app/api/trade-invoices/route.ts:17` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 140 | `GET /api/trade-job-forms` | `src/app/api/trade-job-forms/route.ts:71` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 141 | `POST /api/trade-job-forms` | `src/app/api/trade-job-forms/route.ts:80` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 142 | `PATCH /api/trade-job-forms` | `src/app/api/trade-job-forms/route.ts:122` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 143 | `GET /api/trade-job-notifications` | `src/app/api/trade-job-notifications/route.ts:181` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 144 | `PATCH /api/trade-job-notifications` | `src/app/api/trade-job-notifications/route.ts:189` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 145 | `GET /api/trade-job-packets` | `src/app/api/trade-job-packets/route.ts:67` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 146 | `POST /api/trade-job-packets` | `src/app/api/trade-job-packets/route.ts:84` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 147 | `PATCH /api/trade-job-packets` | `src/app/api/trade-job-packets/route.ts:109` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 148 | `GET /api/trade-job-readiness` | `src/app/api/trade-job-readiness/route.ts:100` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 149 | `POST /api/trade-job-readiness` | `src/app/api/trade-job-readiness/route.ts:114` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 150 | `GET /api/trade-list-views` | `src/app/api/trade-list-views/route.ts:38` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 151 | `POST /api/trade-list-views` | `src/app/api/trade-list-views/route.ts:50` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 152 | `PATCH /api/trade-list-views` | `src/app/api/trade-list-views/route.ts:64` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 153 | `DELETE /api/trade-list-views` | `src/app/api/trade-list-views/route.ts:80` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 154 | `GET /api/trade-opportunities` | `src/app/api/trade-opportunities/route.ts:76` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 155 | `PATCH /api/trade-opportunities` | `src/app/api/trade-opportunities/route.ts:237` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 156 | `POST /api/trade-payment-links` | `src/app/api/trade-payment-links/route.ts:163` | TRD | SRC/JSON/ROUTE | D1/PAY/WRITE+CALL | TXB/ID1/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 157 | `GET /api/trade-photo-requests` | `src/app/api/trade-photo-requests/route.ts:196` | TRD | SRC/JSON/ROUTE | D1/MSG/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 158 | `POST /api/trade-photo-requests` | `src/app/api/trade-photo-requests/route.ts:206` | TRD | SRC/JSON/ROUTE | D1/MSG/WRITE+CALL | TXB/IDP/CC1/C0/RTM/RL2 | T1/D0/E1/UNKNOWN |
| 159 | `DELETE /api/trade-photo-requests` | `src/app/api/trade-photo-requests/route.ts:382` | TRD | SRC/JSON/ROUTE | D1/MSG/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 160 | `GET /api/trade-photo-templates` | `src/app/api/trade-photo-templates/route.ts:200` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 161 | `POST /api/trade-photo-templates` | `src/app/api/trade-photo-templates/route.ts:209` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 162 | `GET /api/trade-price-book` | `src/app/api/trade-price-book/route.ts:119` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 163 | `POST /api/trade-price-book` | `src/app/api/trade-price-book/route.ts:139` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 164 | `PATCH /api/trade-price-book` | `src/app/api/trade-price-book/route.ts:171` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 165 | `GET /api/trade-profile` | `src/app/api/trade-profile/route.ts:79` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 166 | `PATCH /api/trade-profile` | `src/app/api/trade-profile/route.ts:153` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 167 | `POST /api/trade-profile` | `src/app/api/trade-profile/route.ts:211` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 168 | `GET /api/trade-purchasing` | `src/app/api/trade-purchasing/route.ts:171` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 169 | `POST /api/trade-purchasing` | `src/app/api/trade-purchasing/route.ts:182` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 170 | `PATCH /api/trade-purchasing` | `src/app/api/trade-purchasing/route.ts:275` | SUP | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 171 | `GET /api/trade-quick-invoices` | `src/app/api/trade-quick-invoices/route.ts:87` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 172 | `POST /api/trade-quick-invoices` | `src/app/api/trade-quick-invoices/route.ts:98` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 173 | `GET /api/trade-quotes` | `src/app/api/trade-quotes/route.ts:178` | TRD | SRC/JSON/ROUTE | D1/MSG/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 174 | `POST /api/trade-quotes` | `src/app/api/trade-quotes/route.ts:190` | TRD | SRC/JSON/ROUTE | D1/MSG/WRITE+CALL | TXB/IDP/CC0/C0/RTM/RL0 | T1/D0/E1/UNKNOWN |
| 175 | `GET /api/trade-referrals` | `src/app/api/trade-referrals/route.ts:113` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 176 | `POST /api/trade-referrals` | `src/app/api/trade-referrals/route.ts:124` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 177 | `GET /api/trade-schedule` | `src/app/api/trade-schedule/route.ts:149` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 178 | `PATCH /api/trade-schedule` | `src/app/api/trade-schedule/route.ts:159` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 179 | `GET /api/trade-service-follow-ups` | `src/app/api/trade-service-follow-ups/route.ts:141` | TRD | SRC/JSON/ROUTE | D1/MSG/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 180 | `PATCH /api/trade-service-follow-ups` | `src/app/api/trade-service-follow-ups/route.ts:232` | TRD | SRC/JSON/ROUTE | D1/MSG/WRITE+CALL | TXB/IDP/CC1/C0/RTM/RLD | T1/D0/E1/UNKNOWN |
| 181 | `GET /api/trade-team` | `src/app/api/trade-team/route.ts:88` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 182 | `POST /api/trade-team` | `src/app/api/trade-team/route.ts:96` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 183 | `PATCH /api/trade-team` | `src/app/api/trade-team/route.ts:204` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 184 | `GET /api/trade-team/devices` | `src/app/api/trade-team/devices/route.ts:76` | TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 185 | `POST /api/trade-team/devices` | `src/app/api/trade-team/devices/route.ts:87` | MOB | SRC/JSON/ROUTE | D1/I0/WRITE | TX0/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 186 | `PATCH /api/trade-team/devices` | `src/app/api/trade-team/devices/route.ts:132` | TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 187 | `GET /api/trade-team/media` | `src/app/api/trade-team/media/route.ts:253` | MOB | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 188 | `POST /api/trade-team/media` | `src/app/api/trade-team/media/route.ts:269` | MOB | JSON+FORM/JSON/UPLOAD | D1+R2/I0/FILE+WRITE | TX0/IDP/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 189 | `DELETE /api/trade-team/media` | `src/app/api/trade-team/media/route.ts:291` | MOB | SRC/JSON/ROUTE | D1+R2/I0/FILE+WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 190 | `GET /api/trade-team/sync` | `src/app/api/trade-team/sync/route.ts:188` | MOB | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 191 | `POST /api/trade-team/sync` | `src/app/api/trade-team/sync/route.ts:556` | MOB | SRC/JSON/ROUTE | D1/I0/WRITE | TXH/ID1/CC1/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 192 | `GET /api/trade-verification/documents` | `src/app/api/trade-verification/documents/route.ts:74` | SUP+TRD | SRC/JSON+BIN/ROUTE | D1+R2/I0/READ+BIN | TXNA/IDNA/CCNA/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 193 | `POST /api/trade-verification/documents` | `src/app/api/trade-verification/documents/route.ts:111` | SUP+TRD | FORM/JSON/UPLOAD | D1+R2/I0/FILE+WRITE | TX0/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 194 | `DELETE /api/trade-verification/documents` | `src/app/api/trade-verification/documents/route.ts:186` | SUP+TRD | SRC/JSON/ROUTE | D1+R2/I0/FILE+WRITE | TX0/ID0/CC0/CN/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 195 | `GET /api/trade-work-orders` | `src/app/api/trade-work-orders/route.ts:281` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/READ | TXNA/IDNA/CCNA/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 196 | `POST /api/trade-work-orders` | `src/app/api/trade-work-orders/route.ts:291` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |
| 197 | `PATCH /api/trade-work-orders` | `src/app/api/trade-work-orders/route.ts:454` | SUP+TRD | SRC/JSON/ROUTE | D1/I0/WRITE | TXB/ID0/CC0/C0/RT0/RL0 | T1/D0/E1/UNKNOWN |

## API coverage and orphan evidence

Ninety-three of the 94 production-v199 route modules are referenced by at least one test file. `/api/certificate-prices` is the only module without a static test reference. Many tests are source/contract assertions rather than live HTTP integration, so this is breadth evidence, not behavioral coverage.

The reconciled frontend ledger in report 07 expands all wrappers and dynamic prefixes: 55 direct-fetch web components contain 151 global fetch expressions that resolve to **83 unique client API bases**. All 83 have a tracked route module and every statically observed verb is exported. All 55 component files have a tracked page/parent consumer. Therefore the bounded source result is zero missing web handlers, zero client calls without a server contract, zero dead direct-fetch component files and zero duplicate App Router path/method declarations. Request/response shape, runtime authorization and reachability remain `PARTIAL` or `UNKNOWN` because this is not a browser/Worker execution.

After normalizing `/api/job-information/${token}` and `/api/quote-review/${token}` to their `[token]` modules, the remaining 11 of 94 route modules have this complete disposition:

| Non-web-fetch route class | Count | Exact routes and consumer |
|---|---:|---|
| Mobile-only | 2 | `/api/trade-team/media`, `/api/trade-team/sync`; consumed by `mobile/src/lib/uploads.ts` and `mobile/src/lib/sync.ts` |
| External/operational callback or probe | 7 | `/api/health` and `/api/internal/lead-webhook-probe` consumed by the monitor; Resend, Twilio, Square and Stripe callbacks consumed by their providers; `/api/trade-integrations/callback/[provider]` consumed by the OAuth provider redirect |
| Server-rendered signed billing link | 1 | `/api/direct-trade-billing`; `src/lib/direct-trade-billing.ts` supplies the anchor used by the membership page |
| No tracked production caller | 1 | `/api/trade-referrals` GET/POST. Tests read it, but no current component, page, mobile client, monitor or provider calls it. Its POST still requires active paid membership while current product truth says core access is free. Status: `STALE` and orphan candidate; block new use, confirm whether legacy customers require it, then retire route/schema/terms together rather than silently deleting it |

The 197 operation rows contain **217 consumer-class assignments** because a method can have more than one evidenced consumer: ADM 54, BIL 1, CAP 5, CUS 18, MOB 6, OAU 1, OPS 1, PUB 5, SUP 25, TRD 97 and WH 4. These are classifications, not 217 operations. The `/api/trade-referrals` TRD classification is historical intent, not a current caller. No formal endpoint ownership/deprecation catalogue exists. Large action-command routes, especially `/api/trade-crm`, make change impact difficult to reason about and should be split only along proven domain boundaries, not as a speculative rewrite.

Webhook/replay disposition is likewise explicit: Stripe, Square, Resend and Twilio callback operations validate provider signatures and use event/deduplication records; the Apps Script admin-alert branch validates HMAC/freshness/dedupe. Ordinary Apps Script lead POSTs have **no message authentication**: the configured deployment URL supplies only possession/obscurity, while event/reference logic validates content rather than the sender, and exactly-once delivery is unproved. No unsigned provider callback was found, but the ordinary lead relay is a weaker webhook boundary and requires signed delivery plus durable idempotent replay in the target architecture.

## Complete Worker, scheduled, Apps Script and mobile-background operation register

The following normalized rows give all 23 mandatory fields for every non-App-Router operation. Column order is fixed and slash-delimited:

- **Interface/implementation/consumer** = protocol or method / route or event / implementation symbol / callers and consumers.
- **Trust and contract** = authentication / authorization / request schema / response schema / validation.
- **Data and effect** = storage touched / external integrations / side effects / transactions / idempotency.
- **Query/cache/concurrency** = pagination-filtering-sorting / caching / concurrency.
- **Reliability** = retry-timeout / rate limiting.
- **Evidence** = tests / documentation / deployment evidence / current status.

`NA` means genuinely not applicable to that operation; `UNKNOWN` means evidence is missing. A platform trigger is authentication of the event source, not user authorization. Server authorization remains authoritative for every mobile API call.

| ID | Interface / implementation / consumer | Trust and contract | Data and effect | Query / cache / concurrency | Reliability | Evidence |
|---|---|---|---|---|---|---|
| N01 | HTTP any method / incoming Worker request / `worker/index.ts:52-72` `fetch` / browsers, mobile and external HTTP callers | route-specific Firebase, capability, signature or public access / delegated to exact App Router operation / Fetch `Request` plus bindings/context / Fetch `Response` / canonical-host, cache eligibility, response headers and downstream route validation | route-specific D1/R2 / route-specific providers / redirect, read, write, file or callback effects by operation / downstream operation-specific; no Worker-wide transaction / downstream method-specific | downstream query contract / HTML GET cache 120 seconds plus stale 600; `/api/*` excluded / Worker isolates plus downstream controls; no global lock | downstream only; cache failures are swallowed; no Worker-wide timeout/retry / downstream only | source-contract check in `test/site-performance.test.mjs` / this report and report 05 / exact source packaged in v199; root, health and redirect sampled / `VERIFIED DEPLOYED` for entry behavior, route outcomes remain `PARTIAL` or `UNKNOWN` |
| N02 | Cloudflare scheduled event / cron `15 20 * * *` / `worker/index.ts:73-82` `scheduled` / Sites/Cloudflare scheduler | platform-generated event / deployment controls the handler; no end-user role / `ScheduledController`, bindings and execution context / promise registered with `waitUntil`, no business result / configuration supplies the single trigger | D1 through N03-N04 / certificate feed through N04 / concurrently dispatches two jobs / no shared transaction / job-specific only | NA / none / `Promise.all` runs both jobs concurrently | each child catches failure; no automatic retry or timeout / one configured daily event, provider scheduler limits `UNKNOWN` | source assertion in `test/trade-forms-recurring.test.mjs:91` / `vite.config.ts:20-25` and this report / event configuration packaged in v199 / `VERIFIED DEPLOYED` configuration; latest execution `UNKNOWN` |
| N03 | scheduled function call / recurring-service generation / `src/lib/trade-recurring-jobs-server.ts:28-124` `generateDueServiceJobs` / N02 | trusted in-process caller / D1 owner scope is optional input and service predicates bound eligible plans / `{ ownerUid?, sourceWorkOrderId?, today?, limit? }`, Worker passes limit 200 / `{ created, generated, checked }` / bounded limit, due/status and relationship rules | D1 / none / creates service work orders, tasks, appointments and generation records / per-record D1 batch, not whole-run atomic / generation/domain records reduce duplicates but no universal run key | bounded filters and limit, no paging/sort API / none / sequential row loop; database serialization applies | no retry/timeout; N02 catches and logs / limit capped at 200 | helper/source tests in `test/trade-forms-recurring.test.mjs` / source plus this report / exact implementation packaged in v199 / `VERIFIED DEPLOYED` package; current run/result `UNKNOWN` |
| N04 | scheduled function call / certificate-price synchronization / `src/lib/certificate-prices-server.ts:38-84` `syncCertificatePriceHistory` / N02 and stale public GET helper | trusted in-process caller / no user role; source response is validated / optional injected fetch/time, otherwise fixed source / `{ fetchedAt, recordCount }` or thrown failure after failure-row attempt / HTTP status, content/parser and bounded trade normalization | D1 sync/history / Demand Manager certificate-price source / fetches source and writes price plus run state / no whole-fetch-and-write transaction / sync ID is timestamp-derived; price IDs are source/date-derived | source-defined series, no user PFS / public GET has separate cache; job itself none / one job per dispatch, but GET stale refresh may race | no explicit outbound timeout/retry; failure record is best-effort / no application limiter; source quota `UNKNOWN` | certificate route/helper tests / source plus this report / packaged in v199 / `VERIFIED DEPLOYED` package; latest success/freshness `UNKNOWN` |
| N05 | HTTPS POST webhook / Apps Script web-app `doPost` / `integrations/google-apps-script/lead-email-relay.gs:165-183` / Sites lead sender and signed admin-alert sender | no message authentication for ordinary leads, only configured URL possession and obscurity; signed HMAC/freshness for admin alerts; probe branch is explicit test event / event allowlist and branch-specific validation / JSON `e.postData.contents` / text output / JSON parse, honeypot, event allowlist, reference/date validation; admin envelope signature, age and fields | Google Sheet and Script Properties / Gmail/MailApp / writes lead/reminder state, sends mail or delivers privacy-safe admin alert / Script Lock only on admin-alert branch; no cross-Sites/Sheet transaction / admin alerts dedupe by hashed ID; ordinary lead exactly-once unproved | NA / none / admin-alert lock; ordinary lead concurrency behavior `UNKNOWN` | no automatic network retry/timeout in script handler / Apps Script/Sheet/Gmail quotas `UNKNOWN` | helper/source coverage in `test/email-relay.test.mjs` and `test/operational-monitoring.test.mjs` / runbook, report 11 and this report / repository source and Sites key names only; live web-app version unavailable / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; current endpoint `UNKNOWN` |
| N06 | HTTPS GET / Apps Script web-app `doGet` / `integrations/google-apps-script/lead-email-relay.gs:393-417` / public health visitor or reminder-recipient link | public health branch or possession of unsubscribe token / opaque token or legacy email-derived token controls row change / query `action`, `t`, optional legacy `email` / HTML service page / exact action plus token matching and normalized email | Google Sheet / none / may mark matching reminder rows unsubscribed / no transaction or lock across scan/write / repeat unsubscribe is effectively stable, but no formal request key | full Sheet scan, no paging/filter/sort API / none / concurrent writes/trigger activity not reconciled | no retry/timeout / no route limiter; Apps Script quotas `UNKNOWN` | helper/source coverage in `test/email-relay.test.mjs` / privacy/runbook and this report / live deployment unavailable / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; current endpoint `UNKNOWN` |
| N07 | manual Apps Script administrative command / `setup` / `integrations/google-apps-script/lead-email-relay.gs:37-44` / authorised script operator | Google Workspace/script-editor session / provider project permissions / no arguments / void or provider error / platform permissions plus source control flow | Sheet header and Apps trigger metadata / Sheets and Apps Script / synchronizes headers, replaces follow-up trigger, invokes N08 / provider operations are not transactionally atomic / deletes matching follow-up triggers before creating one | NA / none / concurrent setup calls not locked | no retry/timeout / Apps Script quotas `UNKNOWN` | no direct execution test; source is read by relay tests / source and report 06 / live operator, script version and trigger unavailable / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; execution `UNKNOWN` |
| N08 | manual Apps Script administrative command / `setupOperationalMonitoring` / `integrations/google-apps-script/lead-email-relay.gs:46-51` / authorised script operator and N07 | Google Workspace/script-editor session / provider project permissions / no arguments / void or provider error / platform permissions plus source control flow | Apps trigger metadata / Apps Script / replaces the hourly health trigger / no transaction / deletes matching triggers before creating one | NA / none / concurrent setup calls not locked | no retry/timeout / Apps Script quotas `UNKNOWN` | source assertion around monitor in `test/operational-monitoring.test.mjs:190-214`, not live trigger creation / source and report 06 / live trigger unavailable / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; execution `UNKNOWN` |
| N09 | Apps Script time-based event / hourly operational check / `integrations/google-apps-script/lead-email-relay.gs:53-150` `runOperationalHealthCheck` / Apps trigger service and operator mailbox | platform trigger plus Script Property probe token / no end-user role; signed probe authorizes its protected branch / no event body; fixed canonical checks / `{ status, checks, alertSent }` plus log/state / HTTP/JSON validators and privacy-safe alert assembly | Script Properties / Sites health, electricity/gas APIs, signed lead probe and Gmail / writes latest state and sends failure/recovery email / no transaction across probes/state/mail / state transition plus six-hour repeat suppression; no run ID ledger | fixed four-check set, no PFS / sends no-cache headers / four checks are constructed sequentially; provider call behavior internal | no explicit UrlFetch timeout/retry; delivery failure leaves pending-like state / hourly trigger and provider quotas `UNKNOWN` | executed helper monitor tests plus source assertion in `test/operational-monitoring.test.mjs` / runbook, reports 06/11 / source only; live script/trigger unavailable / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; current runs `UNKNOWN` |
| N10 | Apps Script time-based event / daily follow-up job at project hour 09 / `integrations/google-apps-script/lead-email-relay.gs:419-446` `sendFollowUps` / Apps trigger service and due reminder recipients | platform trigger / code selects due, subscribed valid-email rows / no event body / void or thrown provider error / email/date/unsubscribe checks | Google Sheet / Gmail/MailApp / sends due mail, creates opaque token and advances next/last-send fields / no whole-run transaction or lock / due date and updated fields suppress ordinary repeat, but send-before-write failure can duplicate | full Sheet scan, no paging/sort / none / sequential row loop; concurrent setup/manual run not locked | no per-row retry/timeout; one send error can end run / daily trigger and provider quotas `UNKNOWN` | helper/source coverage in `test/email-relay.test.mjs`, no live mail / source and privacy/runbook / source only; live script/trigger unavailable / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; current runs `UNKNOWN` |
| N11 | Expo/OS background event / `aea-field-secure-sync-v1` / `mobile/src/lib/background.ts:7-17` task calling `runSync` / installed app OS scheduler and signed-in field user | current Firebase user required; API requests attach Firebase token / server routes enforce device, owner/team, assignment and revision authorization / no task payload; local queued work and sync cursor / Expo success or failed result / local schemas plus server API validation | encrypted SQLite/files then server D1/R2 / Firebase and Sites APIs / downloads assigned changes, submits offline actions/uploads and resolves receipts / local transaction boundaries and server operations are separate / client action IDs, receipts, upload IDs and revisions provide branch-specific idempotency | cursor/batch rules in sync APIs / local cache; API HTML cache excluded / no explicit single-flight lock between background, reconnect, notification and manual sync | task catches once and returns failed; OS retry/cadence `UNKNOWN`, no explicit timeout / server route limits only; OS quotas `UNKNOWN` | source-contract coverage in `test/native-field-app.test.mjs` and `test/trade-mobile-sync.test.mjs`, no device task execution / mobile README and this report / no signed/store/device deployment evidenced / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; production execution `UNKNOWN` |
| N12 | local mobile lifecycle command / background-task registration / `mobile/src/lib/background.ts:19-21` `registerBackgroundSync` / app provider after Firebase sign-in | signed-in app lifecycle calls it / OS/app permissions govern registration / task name plus `{ minimumInterval: 15 }` / resolved promise or thrown error / Expo API validation | OS task-registration metadata / Expo/OS / registers N11 / NA / repeated-provider semantics not tested | NA / NA / sign-in callback may race lifecycle changes; no guard | no retry/timeout; sign-in finally completes even if preceding registration throws only through outer flow / OS limit `UNKNOWN` | no direct task-registration test / source and report 06 / no signed-device evidence / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; registration state `UNKNOWN` |
| N13 | local mobile lifecycle command / background-task unregistration / `mobile/src/lib/background.ts:23-25` `unregisterBackgroundSync` / sign-out flow | current app session / OS/app permissions govern registration / task name / resolved promise or thrown error / Expo API validation | OS task-registration metadata / Expo/OS / unregisters N11; caller suppresses error / NA / repeated-provider semantics not tested | NA / NA / sign-out may overlap a running task; behavior `UNKNOWN` | caller catches once, no retry/timeout / OS limit `UNKNOWN` | no direct task-unregistration test / source and report 06 / no signed-device evidence / `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; unregistration state `UNKNOWN` |

The Worker cache design avoids accidental API caching but has no authenticated-page cache-key policy or on-demand purge. Because both Worker job promises catch their own errors, platform event completion can coexist with two failed business jobs. The external schedulers add separate failure modes: Apps Script trigger/mail/Sheet state was inaccessible, and Expo task cadence is OS-controlled with no production device telemetry. None has one cross-system durable run ledger, bounded replay tool, SLO and alert path.

## Synchronous delivery ledgers are not queues

Tables and status values use words such as `queued`, `outbox`, `delivery` and `offline_actions`, but no Cloudflare Queue binding or queue consumer exists. Provider calls occur during an API request or deliberate retry:

- email/SMS delivery writes a D1 attempt ledger and calls Resend/Twilio synchronously;
- mobile `action_queue` and `upload_queue` are local device queues consumed by the app;
- `trade_mobile_push_outbox` records push work, but no independently verified production push dispatcher was found;
- webhook routes reconcile provider events synchronously;
- calendar/accounting/payment adapters run inside route requests.

These ledgers improve idempotency and auditability. They do not provide autonomous retry, backpressure isolation or dead-letter handling.

## Security and trust-boundary findings

| Area | Evidence | Finding |
|---|---|---|
| Firebase tokens | `src/lib/firebase-server.ts:17-43` | Issuer/audience/signature/identity checked; revoked-token check absent. |
| Admin controls | `src/lib/admin-server.ts`; admin route guards | Role/status checks exist; console writes additionally require recent owner authentication and typed confirmation. |
| Tenant/team controls | trade/customer helpers and route-scoped queries | Broad application scoping exists, but database-level RLS/FKs do not. Requires adversarial cross-tenant tests. |
| Lead abuse | `src/lib/lead-rate-limit.mjs:1-2,51-130` | Durable HMAC-obscured client key, 5/hour; fail-closed when shared limiter unavailable. |
| Other public/capability endpoints | token routes and public plan APIs | No general IP/actor rate limiter found. Token entropy/expiry helps authorization, not resource-exhaustion abuse. |
| Webhooks | Stripe/Square/Resend/Twilio routes | Provider signature validation and event replay/deduplication are implemented. Production secret rotation/config remains unknown. |
| Uploads | evidence/document/media routes | Size/type limits and authorization exist. Most routes trust client-supplied MIME and no malware scan was found; public customer photo flow additionally sanitizes/re-encodes metadata. |
| SQL injection | route/helper D1 calls | Prepared statements/bindings are standard. Dynamic identifiers in the console are allowlisted in its registry. |
| CSRF/origin | mutation route helpers | Same-origin checks are common. Missing `Origin` is allowed for non-browser/mobile clients, making bearer/capability authorization essential. |

## Reliability and performance findings

1. **Single shared database:** every tenant and domain shares one D1 database. Cloudflare documents single-query execution per database; no D1 Sessions/read-replication usage was found. Capacity and noisy-neighbour behavior are unverified.
2. **Provider timeouts are inconsistent:** calendar sync uses an explicit four-second abort; payment/accounting/OAuth/provider requests generally do not. A stalled provider can consume the Worker request budget and leave “sending”/attempt state requiring manual recovery.
3. **No central retry policy:** some delivery/payment flows have idempotency keys, attempt limits or reconciliation; others have only caught exceptions. Retry must be provider-specific and idempotent, not a blanket wrapper.
4. **GET with write side effect:** `/api/certificate-prices` may refresh stale data. This complicates caching, incident reasoning and load control; scheduled/admin refresh should own writes.
5. **No dependency health:** `/api/health` returns a constant healthy service response and does not check D1, R2, Firebase JWK reachability or providers. Keep a lightweight liveness endpoint, but add a protected readiness/dependency diagnostic.
6. **No request tracing/SLO:** `api_performance_samples` exists, but no comprehensive request ID, structured log schema, error aggregation, percentile SLO or alert integration was proved.

## Operational commands and repository tooling

The repository exposes exactly 23 executable CLI interfaces: 14 root npm scripts, eight mobile npm scripts and one direct synthetic-population generator. No tracked Sites package/save/deploy command exists; the previously assumed `scripts/package-site.sh` path is absent from the tree and all Git history. `scripts/compat/load-electricity-model.cjs` is a required compatibility module, not a command interface.

Every CLI row resolves the 23 mandatory fields through this common contract plus its explicit overrides:

| Mandatory field | Common CLI resolution |
|---|---|
| Protocol/method; route/event; implementation symbol; callers/consumers | Local process/CLI; exact command in the row; exact manifest script or direct file; developer, auditor or release operator as stated |
| Authentication; authorization | Host OS/shell identity; filesystem/process permissions. These do not grant application/provider authority. C23 overrides the external identity boundary |
| Request; response; validation | Arguments/environment/repository files; stdout/stderr, numeric exit and named artifacts; the invoked tool/script owns validation. Missing schema is explicit in the row |
| Storage; external integrations; side effects | Row-specific. Local temporary/build/output writes are named; absence of provider access is not inferred merely from a local command |
| Transactions; idempotency | `NA` for an operating-system process transaction; rerun behavior is tool-specific and named when material. No command has a cross-filesystem/provider transaction |
| Pagination/filtering/sorting; caching; concurrency | `NA` unless the row names arguments; tool/dependency caches may apply; one invoked process unless the implementation explicitly parallelizes |
| Retry/timeout; rate limiting | No wrapper-level retry, timeout or limiter unless the row overrides it; provider/tool limits remain `UNKNOWN` |
| Tests; documentation; deployment evidence; current status | Tests/gates named per row; manifest/source plus this report; deployment evidence only where expressly recorded; shared taxonomy in the final clause |

| ID | Exact operation, implementation and consumer | Inputs, outputs and validation overrides | Storage, integration, side-effect and control overrides | Tests, documentation, deployment evidence and current status |
|---|---|---|---|---|
| C01 | `npm.cmd run dev`; `package.json:6` -> `vinext dev`; developer | Framework arguments/environment -> long-running dev server/logs; Vinext validates configuration | May write development caches/artifacts and listen on a local port; no transaction; termination controls lifecycle | No CLI-specific test; manifest/source; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C02 | `npm.cmd run build`; `package.json:7` -> `vinext build`; release operator | Repository/config/environment -> production artifact/log/exit | Writes build output; build cache/tool concurrency internal; rerunnable but not an immutable promotion | Aggregate release record says passed at `4a5cd19` and v199 uses that source; `VERIFIED DEPLOYED` artifact provenance, audit-local execution `BLOCKED` by write boundary |
| C03 | `npm.cmd run audit:links`; `package.json:8`, `scripts/audit-links.mjs`; documentation auditor | Repository links and network availability -> categorized stdout/exit; script owns URL parsing | Reads tracked content and performs HTTP checks; no project mutation intended; remote rate/automation policies apply | Executed by documentation workstream: 177 checks and exit 1; report 04; no deployment claim; `PARTIAL` because five method-bound results and one credible unresolved destination remain |
| C04 | `npm.cmd run benchmark:scale`; `package.json:9`, `scripts/benchmark-scale-100k.mjs`; performance reviewer | Fixed 100k-per-dataset workload, 30 rounds and 75 ms local p95 guard -> JSON/exit | In-memory SQLite only; generates 400k benchmark rows, queries and plans; no provider; process-internal setup is disposable | Source/test references only; not run in this audit; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`, production capacity `UNKNOWN` |
| C05 | `npm.cmd run start`; `package.json:10` -> `vinext start`; operator | Built artifact/config -> long-running local server/logs | Reads build output and listens locally; no production Sites control | No CLI-specific test/run; manifest; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C06 | `npm.cmd run lint`; `package.json:11` -> `eslint`; developer/CI candidate | Tracked source/config -> findings/exit | Read-oriented; ESLint/tool cache behavior not separately configured | Audit run exit 0 in report 12; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C07 | `npm.cmd run typecheck`; `package.json:12` -> `tsc --noEmit --pretty false`; developer/CI candidate | TypeScript project -> diagnostics/exit | Declares no emit; TypeScript incremental/cache behavior follows config | Equivalent stricter direct audit command passed; release record says validate passed; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` as a check |
| C08 | `npm.cmd test`; `package.json:13` -> Node test runner; developer/CI candidate | Test discovery/environment fixtures -> TAP/results/exit | Temporary in-memory/local test state; two NEM12 cases require external fixture path; test concurrency belongs to Node | Audit run: 699 cases, 697 pass, two skips, exit 0; report 12; no runtime deployment proof; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C09 | `npm.cmd run test:coverage`; `package.json:14`; developer/CI candidate | Same suite plus Node experimental coverage -> coverage output/exit | The configured command names no artifact path; no repository coverage artifact or threshold is configured | Not run; no process result or coverage measure exists for this audit, so the result is `UNKNOWN` and the coverage control is `PARTIAL`; no evidence supports classifying the command itself as `BLOCKED` |
| C10 | `npm.cmd run test:integration`; `package.json:15`; developer/CI candidate | Six exact test modules -> TAP/results/exit | Local test state; no real provider/production environment | Included in full passing suite but script not separately invoked by audit; release record says 33 integration tests passed; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C11 | `npm.cmd run db:check`; `package.json:16`, `scripts/check-migrations.mjs`; database reviewer | All `drizzle/*.sql` -> Wrangler output/verification/exit | Creates a unique OS-temp Wrangler config/D1 state, applies 79 migrations, queries verification tables and removes the validated temp root in `finally`; no production binding | Audit exit 0; report 12; proves fresh replay only; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C12 | `npm.cmd run synthetic:validate`; `package.json:17`, `scripts/validate-synthetic-population.mjs`; reviewer | Production migrations plus five opt-in synthetic fixtures -> count/invariant JSON or exit | In-memory SQLite; no provider; validates expected synthetic counts | Source and tests only; not separately run by this audit; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C13 | `npm.cmd run validate`; `package.json:18`; release operator | Sequential C07, C06, C10, C08, C11 and C02 -> combined exits/artifacts | Inherits build/temp/test effects; shell `&&` stops on first failure; no remote enforcement or immutable result store | Audit-local run `BLOCKED` by build-output boundary; external release record says passed at `4a5cd19`; `VERIFIED DEPLOYED` only for that bounded release provenance |
| C14 | `npm.cmd run db:generate`; `package.json:19` -> `drizzle-kit generate`; schema maintainer | Current Drizzle schema/config -> generated SQL/meta or error | Writes migration and metadata source files; not transactionally tied to deployed D1; rerun can produce new artifacts | Not run; 11-file journal drift already exists; no deployment evidence; `BLOCKED` pending canonical-migrator decision and reviewed diff |
| C15 | `npm.cmd --prefix mobile run start`; `mobile/package.json:52` -> `expo start`; mobile developer | Expo args/environment -> Metro/dev service/logs | May write Expo/Metro caches and expose development service; provider/network use tool-dependent | Not run; source only; no signed app evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C16 | `npm.cmd --prefix mobile run android`; `mobile/package.json:53` -> `expo run:android`; mobile developer | Native toolchain/device/environment -> Android build/install/logs | Writes native/build artifacts and can install on a connected emulator/device; credentials/toolchain unproved | Not run; no device/store evidence; `BLOCKED` by absent approved native environment and signed-device acceptance |
| C17 | `npm.cmd --prefix mobile run ios`; `mobile/package.json:54` -> `expo run:ios`; mobile developer | Apple native toolchain/device/environment -> iOS build/install/logs | Writes native/build artifacts and can install; unavailable on this Windows host and signing unproved | Not run; no device/store evidence; `BLOCKED` |
| C18 | `npm.cmd --prefix mobile run web`; `mobile/package.json:55` -> `expo start --web`; mobile developer | Expo web args/environment -> dev service/logs | Writes caches and serves optional web build; not the production Sites app | Not run; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C19 | `npm.cmd --prefix mobile run lint`; `mobile/package.json:56` -> `expo lint`; mobile developer | Mobile source/config -> findings/exit | Read-oriented; may resolve tool/config through installed Expo | Exact script not run; root ESLint traversed mobile and passed; no deployment evidence; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C20 | `npm.cmd --prefix mobile run typecheck`; `mobile/package.json:57` -> `tsc --noEmit`; mobile developer | Mobile TS config -> diagnostics/exit | No emit; tool cache behavior follows config | Equivalent direct mobile TypeScript command exited 0; no device deployment proof; `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| C21 | `npm.cmd --prefix mobile run doctor`; `mobile/package.json:58` -> unpinned `npx expo-doctor@latest`; mobile developer | Local project plus registry/latest package -> diagnostics/exit | Network/package-cache side effects and version drift; no repository pin, retry, timeout or result archive | Not run and no approved package installation; `BLOCKED` for reproducible audit use |
| C22 | `npm.cmd --prefix mobile run export:verify`; `mobile/package.json:59`; mobile release operator | Expo project/native toolchain -> Android then iOS exports under `dist/android` and `dist/ios` | Writes large artifacts; second command runs only after first succeeds; credentials/platform capability may be required | Not run; Windows/iOS and signed release evidence absent; `BLOCKED` |
| C23 | `node scripts/seed-synthetic-population.mjs [--out PATH] [--sql PATH] [--broker URL] [--broker-secret-file PATH]`; direct script; explicitly authorised synthetic-test administrator only | Optional paths/broker plus environment secret; fixed batch drafts -> JSON summary, credentials CSV and SQL fixture; validates exactly 350 completed accounts | **A no-argument run uses the application Firebase client project to attempt sign-up/sign-in/update for 350 identities**, retries selected failures up to eight times with four workers, writes plaintext password checkpoint/CSV files and overwrites the selected SQL path (the default is the tracked synthetic fixture), then deletes the checkpoint; broker mode posts credentials to an arbitrary supplied URL. There is no cross-provider/filesystem transaction or rollback. Interrupted runs may resume, but completed reruns generate new passwords for fixed emails and normally cannot sign into existing accounts, so the operation is not idempotent | No safe environment/project/emulator allowlist, confirmation, dry-run, limit, broker HTTPS/host/secret check or package-script gate was found; docs claiming explicit/out-of-repository output are not enforced. It was not run. Tests inspect source patterns, not execution safety. Local safety control is `BROKEN`; provider capability/prior execution are `UNKNOWN`, and use against any shared/current provider is `BLOCKED` pending redesign |

There is no repository CI workflow. Operational scripts and checks are manually invoked, results are not retained by an enforced pipeline, and no tracked CLI can create a Sites saved version or deploy it. C23 is the exception to the otherwise local tooling posture: source possession plus ordinary Firebase self-service signup can cause external identity mutations, so it requires an isolated project guard or removal before routine use.

## Prioritized backend remediation

1. Move or disable payment-enabling routes on Sites until host policy is resolved; preserve provider-neutral D1 ledgers.
2. Establish owner-controlled D1/R2 access, backup/export/restore, and a non-production recovery rehearsal.
3. Add a durable scheduled-job run/attempt ledger, alerting and idempotent retry; stop swallowing both job failures as event success.
4. Add bounded timeouts and provider-specific retry/idempotency contracts for every outbound request.
5. Add revocation-aware Firebase authorization and adversarial tenant/team/capability tests.
6. Introduce CI and an exact source-to-Sites-version release gate.
7. Publish a machine-readable API contract incrementally for stable external/mobile/capability endpoints; avoid a wholesale rewrite of action routes.

## Validation and limits

Static route inventory, method count, test references, D1 batches and query/body/form selectors were recomputed against application commit `4a5cd19`; docs-only `ff3c8ef` does not alter them. `npm.cmd run db:check` passed. Sites v199 exact source/deployment status was verified read-only. No production mutation, signed-in provider action, real payment, message, upload, mobile sync or cron invocation was performed by this audit; the separate release QA explicitly records no production row mutation. Provider configuration, quotas and current job success therefore remain unknown.
