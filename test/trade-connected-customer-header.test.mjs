import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dashboard = fs.readFileSync(
  new URL("../src/components/DirectTradeDashboard.tsx", import.meta.url),
  "utf8",
);

const leadList = dashboard.slice(
  dashboard.indexOf("visibleLeadOpportunities.map"),
  dashboard.indexOf("No leads match these filters"),
);

test("authorised customer identity is the first selected lead preview section", () => {
  assert.match(
    leadList,
    /const releasedCustomerContact = opportunity\.customerContact;/,
  );

  const headingPosition = leadList.indexOf(
    'className="dashboard-opportunity-heading"',
  );
  const identityPosition = leadList.indexOf(
    'className="dashboard-connected-customer-identity"',
  );
  const compactSummaryPosition = leadList.indexOf(
    'className="dashboard-opportunity-compact-summary"',
  );
  const enquiryPackPosition = leadList.indexOf("<EnquiryPack");

  assert.ok(headingPosition > -1);
  assert.ok(identityPosition > headingPosition);
  assert.ok(compactSummaryPosition > identityPosition);
  assert.ok(enquiryPackPosition > compactSummaryPosition);
  assert.match(
    leadList,
    /releasedCustomerContact && \([\s\S]*dashboard-connected-customer-identity[\s\S]*hidden=\{!isExpanded\}/,
  );
  assert.match(
    leadList,
    /aria-labelledby=\{\s*isExpanded\s*\? customerIdentityHeadingId\s*: undefined\s*\}/,
  );
  assert.match(
    leadList,
    /hidden=\{!isExpanded\}[\s\S]*\{isExpanded && \(/,
  );
  assert.match(leadList, /aria-controls=\{`opportunity-\$\{opportunity\.matchId\}`\}/);
  assert.match(
    leadList,
    /id=\{`opportunity-\$\{opportunity\.matchId\}`\}[\s\S]*hidden=\{!isExpanded\}/,
  );
  assert.match(
    leadList,
    /id=\{detailId\}[\s\S]*aria-labelledby=\{previewHeadingId\}[\s\S]*hidden=\{!isExpanded\}/,
  );
  assert.match(
    leadList,
    /id=\{customerIdentityId\}[\s\S]*className="dashboard-connected-customer-identity"/,
  );
  assert.match(
    leadList,
    /const customerDisplayName = releasedCustomerName[\s\S]*\|\| opportunity\.title[\s\S]*\|\| "Customer enquiry"/,
  );
  assert.match(
    leadList,
    /<h3 id=\{previewHeadingId\}>\{customerDisplayName\}<\/h3>/,
  );
  assert.match(
    leadList,
    /aria-label=\{`Contact details for \$\{customerDisplayName\}`\}/,
  );
});

test("released contact details have one authoritative block", () => {
  assert.equal(
    (leadList.match(/dashboard-connected-customer-identity/g) || []).length,
    1,
  );
  assert.equal(
    (leadList.match(/Customer-authorised contact/g) || []).length,
    1,
  );
  assert.equal(
    (leadList.match(/<dt>Phone<\/dt>/g) || []).length,
    1,
  );
  assert.equal(
    (leadList.match(/<dt>Email<\/dt>/g) || []).length,
    1,
  );
  assert.match(leadList, /releaseScope === "all_qualified_trades" \? "Service area" : "Service address"/);
  assert.match(leadList, /Customer message/);
  assert.doesNotMatch(
    leadList,
    /className="dashboard-contact-allowance released"/,
  );
});

test("unselected previews stay hidden and connected leads retain the contact boundary", () => {
  assert.match(
    leadList,
    /const releasedCustomerName =\s*releasedCustomerContact\?\.name\.trim\(\) \|\| ""/,
  );
  const compactSummary = leadList.slice(
    leadList.indexOf('className="dashboard-opportunity-compact-summary"'),
    leadList.indexOf('className="dashboard-opportunity-details"'),
  );
  assert.doesNotMatch(
    compactSummary,
    /customerContact|releasedCustomerContact|tel:|mailto:|Service address/,
  );
  assert.match(
    leadList,
    /opportunity\.matchStatus === "connected" && !releasedCustomerContact/,
  );
  assert.match(
    leadList,
    /const isExpanded = selectedLeadOpportunity\?\.matchId === opportunity\.matchId;[\s\S]*hidden=\{!isExpanded\}/,
  );
  assert.match(
    dashboard,
    /opportunity\.customerContact[\s\S]*The customer-selected contact and service address above are released to this business\.[\s\S]*Customer identity, contact details, street and unit address/,
  );
});
