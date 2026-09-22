# MYOB integration processor register

Reviewed against public provider documentation: 22 September 2026. Owner: James, Australian Energy Assessments Pty Ltd (AEA). Contact: info@ausenergyassessments.com.

This is the operational inventory for TLink's intended MYOB data flow. Public contractual coverage and actual account configuration are separate evidence. No provider signature, account-specific acceptance record, residency guarantee or MYOB hosting exemption is invented in this register. MYOB production activation requires the unresolved items below to be closed.

## 1. Data flow and permitted roles

```text
Authorised TLink business user
  -> Firebase Authentication: user identity and MFA, not MYOB ledger records
  -> TLink hosted by OpenAI Sites
       -> Cloudflare runtime / D1: integration processing and minimal stored records
       -> R2: only application storage actually required and explicitly inventoried
       -> MYOB API: that business's authorised company file

Codex / other development AI / TLink AI assistant
  -> source code, public documentation and synthetic test fixtures only
  -> no production MYOB data, derived extracts, OAuth credentials or secrets
```

R2's existence in the application does not establish that it currently stores MYOB financial data or a protected audit archive. Record each actual MYOB-related bucket/prefix and purpose before enabling it. Do not send MYOB-derived information to analytics, marketing, email, SMS or calling providers by implication. Adding a processing destination requires a purpose review and register update before transmission.

## 2. Provider inventory

| Provider/service | Relationship and purpose | Permitted information | Contract and location evidence | Account-specific state |
| --- | --- | --- | --- | --- |
| OpenAI Sites | Direct hosting service used for the TLink application; manages hosting providers on the operator's behalf | Application requests and minimal integration records needed to run the authorised service; secrets supplied only through the restricted human operations path | The Sites DPA applies to published hosted personal data for individual Plus/Pro accounts and is incorporated through use. Business accounts use the applicable business DPA or signed agreement. No AU-only processing guarantee has been established. | OPEN: record the actual contracting account/entity, plan, applicable agreement and evidence date. Verify who can access Sites production data, secrets, settings and deployment capabilities. |
| Cloudflare runtime and D1 through Sites | Downstream hosting/database services in the Sites-managed deployment, not automatically a separate AEA-negotiated contract | Server-side provider calls, encrypted connection credentials and minimal tenant-scoped integration data | OpenAI lists Cloudflare for web hosting and binds its subprocessors to comparable obligations under the Sites DPA. D1 location hints are not guaranteed residency; read replication may distribute data beyond the primary location. | OPEN: confirm the actual database location/replication, backup retention and deletion, encryption/access controls, and the administrative boundary exposed by Sites. |
| Cloudflare R2 through Sites | Downstream object storage, limited to documented application purposes | Only records justified in the storage inventory; security audit objects only after the protected-retention configuration is verified | R2 location hints are best effort. Documented jurisdiction controls list EU, US and FedRAMP, not a guaranteed Australian jurisdiction. Bucket locks are a configurable capability, not proof they are enabled here. | OPEN: identify actual MYOB-related buckets/prefixes, locations, lifecycle/lock rules, backup or copy behaviour, authorised readers/writers and separate lock administrators. |
| Google Firebase Authentication | AEA's identity provider; governs login and MFA capability | User identity, email/password authentication material, optional enrolled factors and security metadata. MYOB customer, invoice, payment and ledger records must not be stored here. | Firebase Authentication is governed by Google Cloud Platform Terms and the Cloud Data Processing Addendum. Google states that Authentication processes in the US. | OPEN: record the Google project/contracting entity and accepted agreement; verify Identity Platform/MFA capability, enrolment, human provider IAM and recovery controls. |
| MYOB | Accounting API provider and customer-authorised company-file destination; not a general-purpose downstream analytics service | Explicitly approved customer/invoice operations and read-only mapping/status information | Developer Program terms and security requirements apply. Each business authorises its own file; access is purpose-limited. | OPEN: developer approval, issued application credentials via human-only setup, agreed initial scope and any hosting-location resolution. |

The public documents support the described agreement routes. They do not establish that AEA has individually negotiated or signed a DPA with every infrastructure provider. For Cloudflare resources directly operated by AEA outside Sites, add a separate account entry with the applicable Cloudflare subscription agreement and DPA evidence; do not silently treat a direct resource as Sites-managed.

## 3. Contract and service evidence

| Evidence | What it establishes | Limit of the evidence |
| --- | --- | --- |
| [ChatGPT Sites DPA](https://openai.com/policies/chatgpt-sites-data-processing-addendum/), published 9 July 2026 | Published personal data is processed for hosting, maintenance and support; the DPA is incorporated through publishing/hosting; downstream processor obligations are addressed | It explicitly excludes prompts/files/content supplied when creating or editing the Site. A hosting DPA does not authorise sending production data to Codex. Actual account agreement still needs to be recorded. |
| [OpenAI subprocessor list](https://openai.com/policies/sub-processor-list/), updated 9 July 2026 | Lists Cloudflare web hosting and expressly addresses Sites processing for Pro/Plus | Hosting providers may run security/safety classifiers on web pages. Do not promise that hosting uses no automated classifier. This is distinct from permitted development access, which this integration prohibits for live MYOB data. |
| [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) and [Australian privacy guidance](https://www.cloudflare.com/trust-hub/australia-privacy-act/) | Cloudflare publishes processor obligations and states DPA incorporation into its subscription agreements | Does not prove a separate AEA account agreement or a particular Sites-managed resource's settings. |
| [Firebase service terms](https://firebase.google.com/terms), [Google Cloud terms](https://cloud.google.com/terms) and [Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) | Authentication is within the GCP-governed service group; the Cloud DPA forms part of that contract route | Do not substitute the standalone Firebase Data Processing and Security Terms for the Authentication contract. Actual project/entity acceptance evidence remains required. |
| [Firebase privacy documentation](https://firebase.google.com/support/privacy) | Authentication processes in the US; deleted identity records can take up to 180 days to leave live/backups; logged IP addresses are kept for a few weeks | Does not establish a deletion horizon for Sites/D1/R2, or permission to place ledger information in identity services. |
| [D1 data locations](https://developers.cloudflare.com/d1/configuration/data-location/) and [R2 data locations](https://developers.cloudflare.com/r2/reference/data-location/) | Distinguish a performance location hint from a jurisdiction guarantee | An Oceania hint, Australian user or Australian domain is not evidence of AU-only processing. |
| [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) | Locks can protect objects against deletion/overwrite for a chosen period; lock rules have a separate configuration interface | No lock or locked audit archive is confirmed for this application by the existence of that product feature. |

## 4. Required account evidence

James or a named authorised human operator must complete this evidence register in restricted operational storage. Use references here rather than credentials, private contractual documents, recovery codes or production data.

| Item | Evidence required | Current result |
| --- | --- | --- |
| Hosting and identity contracting entities | Account/entity, account owner, service/plan, applicable agreement version or date and acceptance/use record | UNVERIFIED |
| Subprocessor relationship | Sites provider chain and any separately AEA-operated resources; documented service purpose and data categories | Public chain documented above; deployment-specific inventory UNVERIFIED |
| Human privileged access | Named access register, MFA enforcement, minimum roles, recovery and immediate offboarding process; first quarterly review date | UNVERIFIED |
| AI separation | Removal of production-capable tool credentials, database/secret/console access and authenticated financial browsing; negative access check | UNVERIFIED |
| Data location | Runtime/database/object location, replicas, backups and any provider support access; identify countries and unresolved regions | Firebase US confirmed publicly; actual Sites storage location UNVERIFIED |
| Protected logs | Actual destination, 365-day minimum retention, lock configuration, separate administration and retrieval/overwrite-denial test | UNVERIFIED |
| Deletion and backups | Actual active deletion operation, provider backup retention, restoration reapplication and the evidence for any exception | Firebase published deletion horizon recorded; Sites storage horizon UNVERIFIED |
| Monitoring and incident support | Alert recipients and delivery test, incident contact route, backup coordinator, support permissions and restricted evidence destination | UNVERIFIED |
| MYOB overseas-hosting resolution | Written disclosure of the actual arrangement and MYOB's response or any required exemption/conditions | NOT OBTAINED |
| Final operational approval | James's recorded decision referencing completed evidence and the verified release | NOT RECORDED |

Do not close an item because source code implements a related check. Provider configuration, deployed behaviour and human access evidence are required where identified. Keep MYOB disabled until critical items are resolved.

## 5. Overseas-processing disclosure

The disclosure to MYOB must identify OpenAI Sites and its Cloudflare hosting/database/object-storage chain, any actual storage/replica locations established by the evidence review, and US Firebase identity processing. State unknown managed-hosting locations explicitly while seeking clarification; do not describe the application as entirely Australian-hosted.

MYOB's security requirements instruct developers to contact MYOB when client data is stored outside Australia/New Zealand; its terms also restrict locations or providers that conflict with notified requirements. Request resolution for the actual deployment before activation. MYOB review is not replaced by having a DPA or by selecting an Oceania hint.

## 6. Register maintenance

- Review at least quarterly, before adding a provider or new data category, and when the hosting/account arrangement changes.
- Record the business need, data categories, agreement, location, access controls, retention/deletion limits and approval evidence for every addition.
- Review provider contract/subprocessor change notices and record any impact on MYOB obligations. Subscribe a human operational contact to change notices through the relevant provider account where available; do not claim subscription until completed.
- Give MYOB the current register on request through its verified support channel. Supply detailed private account evidence only through an agreed secure route.
- Remove obsolete destinations and revoke their access after migration; verify disposal and retain only the necessary closure evidence.

See [MYOB security operations](MYOB_SECURITY_OPERATIONS.md) for the operative development restriction, access review, retention and incident procedures. Source obligations: [MYOB security requirements](https://developer.myob.com/program/security-requirements/) and [MYOB Developer Program terms](https://www.myob.com/au/legal/sme-developer-terms), particularly sections 29 and 35 to 41.
