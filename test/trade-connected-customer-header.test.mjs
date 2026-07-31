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

test("connected released customer identity is the first expanded lead section", () => {
  assert.match(
    leadList,
    /const releasedCustomerContact =\s*opportunity\.matchStatus === "connected"\s*\? opportunity\.customerContact\s*: null;/,
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
  assert.match(
    leadList,
    /releasedCustomerContact\s*\?\s*`\$\{customerIdentityId\} \$\{detailId\}`\s*:\s*detailId/,
  );
  assert.match(
    leadList,
    /id=\{customerIdentityId\}[\s\S]*className="dashboard-connected-customer-identity"/,
  );
  assert.match(
    leadList,
    /className="dashboard-connected-customer-contact-grid"[\s\S]*aria-label=\{`Contact details for \$\{releasedCustomerContact\.name\}`\}/,
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
  assert.equal(
    (leadList.match(/<dt>Service address<\/dt>/g) || []).length,
    1,
  );
  assert.doesNotMatch(
    leadList,
    /className="dashboard-contact-allowance released"/,
  );
});

test("collapsed and unconnected leads remain privacy safe", () => {
  assert.match(
    leadList,
    /\{releasedCustomerContact\s*\? releasedCustomerContact\.name\s*: opportunity\.title\}/,
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
    /releasedCustomerContact \? null : opportunity\.matchStatus === "connected"/,
  );
});
