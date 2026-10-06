import type { WattzunPortal, WattzunReply, WattzunTurn } from './wattzun-portal.ts';

export type WattzunGuideLink = { id: string; label: string; href: string; description: string };

// Verified against the workspace search parsers and the named panels. This catalogue
// describes product capabilities, not records loaded by this conversation or granted access.
export const WATTZUN_PORTAL_GUIDE: Record<WattzunPortal, WattzunGuideLink[]> = {
  trade: [
    // DirectTradeDashboard.dashboardWorkspaceFromSearch / dashboardWorkViewFromSearch.
    { id: 'trade_work', label: 'Work', href: '/direct-trade/dashboard?workspace=work', description: 'Business owners use Work for Home dashboard, Jobs and Customers. Staff use their staff workspace. Open the exact job before reviewing details; permissions still apply.' },
    { id: 'trade_leads', label: 'Leads', href: '/direct-trade/dashboard?workspace=leads', description: 'Leads contains enquiries and import or quote handoff. It is separate from Sales and from job delivery status.' },
    // TradeSalesWorkspace, trade-sales-server; Sales is also in teamWorkspaceLocation.
    { id: 'trade_sales', label: 'Sales', href: '/direct-trade/dashboard?workspace=sales', description: 'Sales lists prospects with owner, estimate excluding GST, expected close, last recorded contact and next action/date. Filter or load more cards, move open stages and open the same job. Only the business owner adds, renames or reorders stages. Won comes from accepted quote decisions; Lost from the recorded job outcome. Sales ownership does not grant job access. Office staff use Sales in their staff navigation when eligible.' },
    { id: 'trade_schedule', label: 'Schedule', href: '/direct-trade/dashboard?workspace=schedule', description: 'Schedule arranges visits and assigned work. Check the actual job, staff availability and permissions in that workspace; this conversation has not read the diary.' },
    // TradeFinanceWorkspace and TradeQuotePanel.
    { id: 'trade_finance', label: 'Finance', href: '/direct-trade/dashboard?workspace=finance', description: 'Finance contains Quotes, Invoices, Price book and Reports & projections. The user reviews and submits document and payment actions. No quote, price, report or payment record has been loaded here.' },
    { id: 'trade_quotes', label: 'Quotes', href: '/direct-trade/dashboard?workspace=finance&financeView=quotes', description: 'In Quotes, prepare a new quote or open the exact job quote. Review scope, line items, tax treatment, exclusions and customer details before the saved quote/PDF or customer delivery workflow. The exact job Customer Q&A panel offers AI brief and draft scope when Interested is on and quote access allows: Generate brief, review linked Job details/Question sources, then Copy draft scope for manual quote review. That separate tool uses saved shared answers and a live source check; uploaded files are not read and nothing is sent or added to the quote. This conversation does not run it or create/send a quote.' },
    // TradeFormsWorkspace / TradeBusinessFormEditor / InstallerCrmWorkspace Files and Answers.
    { id: 'trade_forms', label: 'Forms', href: '/direct-trade/dashboard?workspace=forms', description: 'Forms designs reusable business forms using short/long text, date, select and confirmation fields, required questions, before/after stages and conditions on an earlier select or checkbox. With authoring access, the business forms library has Draft with Wattzun: supply Form purpose and Available on, Generate draft, review the unsaved designer and Try the form, then explicitly Save form. That separate tool drafts a new supporting template; it does not fill job answers or change an existing saved form. Add a saved business form to a job from Files. Existing job records retain their saved version. Creditex compliance forms are view-only previews; preview answers are not saved or regulatory approval.' },
    { id: 'trade_onsite', label: 'Job files and answers', href: '/direct-trade/dashboard?workspace=work', description: 'For onsite help open the assigned job. Files contains job forms, evidence and saved files; Answers reads saved form responses. Review and correct the actual records there. This conversation can explain a pasted question or draft a checklist; it cannot see photos, signatures or saved answers.' },
    { id: 'trade_staff', label: 'Staff workspace', href: '/direct-trade/team', description: 'Staff use Jobs, Schedule, Sales, Forms, Connect, My time and Tasks & training where their permissions allow. Sales is for eligible office staff, not crew access. Use this route when working as a team member; owner dashboard links do not confer owner permissions.' },
    { id: 'trade_team', label: 'Team', href: '/direct-trade/dashboard?workspace=team', description: 'Team manages people, permissions and member records subject to team-management access. This conversation does not grant or change access.' },
  ],
  council: [
    // CouncilWorkspace tabs are state-driven, without a general tab deep link.
    { id: 'council_campaigns', label: 'Council workspace', href: '/council', description: 'Select Campaigns or Information sessions for outreach and referral links. Draft invitations, resident explanations and session plans from supplied facts; review and save or share in the council workspace.' },
    { id: 'council_reports', label: 'Council workspace', href: '/council', description: 'Select Reports & insights for reporting coverage and calculation basis, and the community views for official-source figures and their date. This conversation has not loaded live figures. Keep observed uptake, estimates and community outcomes distinct.' },
    { id: 'council_team', label: 'Council workspace', href: '/council', description: 'Select Council team for authorised people and access. Council role and selected council determine controls; this conversation cannot change them.' },
  ],
  creditex: [
    // CreditexCompliancePortal Jobs; CreditexJobAuditDesk and its existing AI pre-review.
    { id: 'creditex_audits', label: 'Creditex workspace', href: '/creditex/compliance', description: 'Select Jobs and open the exact job audit desk to review saved answers, requirements, evidence records and correction notes. Auditor permissions apply. This conversation can explain supplied material, not mark audited or approve eligibility.' },
    { id: 'creditex_findings', label: 'Creditex workspace', href: '/creditex/compliance', description: 'The exact job audit desk has Review with AI for saved answers, case requirements and file metadata, with linked sources and a stale-source check. That tool does not inspect photo/PDF contents, signatures or call recordings. A reviewer checks suggestions and uses correction wording manually. This conversation has not loaded that job or run its pre-review; findings do not establish regulator acceptance.' },
  ],
};

export const WATTZUN_TASK_GUIDANCE: Record<WattzunPortal, readonly string[]> = {
  trade: [
    'For quote help, use the supplied scope, equipment/specification, quantities and stated rates to draft scope, line-item wording, exclusions or a customer follow-up. Ask only for missing details needed for the requested output. Do not invent prices, GST status, rebate entitlement or a binding offer; leave unknowns explicit and point to Quotes for review and entry.',
    'For a business-form draft, give a short practical list of question labels, supported answer types and required/optional status, with before/after stages or simple earlier-answer conditions only when useful. Keep within the existing 30-question limit and 8 questions per page. For an editable new template guide authorised authors to Forms, Draft with Wattzun, their supplied purpose/users/work process, Generate draft, review and Try the form, then explicit Save form. That separate helper drafts up to 12 questions, without conditions or job answers. This conversation does not invoke it. Do not rewrite a governed compliance form or claim the proposed checklist satisfies regulation.',
    'For a quote draft grounded in saved customer answers, guide the authorised user to the exact job Customer Q&A, turn on Interested if appropriate, open AI brief and draft scope and choose Generate brief. They review linked sources and use Copy draft scope before manual quote entry. This separate feature requires current view/manage quote access and source checks; this conversation cannot run it, read uploaded files, apply prices, add scope to a quote or send anything.',
    'For onsite questions, help interpret a supplied form question, organise observed facts or create a job-specific preparation/evidence checklist. Never fabricate an observation, completed inspection, signature, safe condition or missing answer. Send record-specific work to the exact job Files/Answers. Relevant trade, energy, equipment and site-safety explanations are in scope, with uncertainty and verification needs stated.',
    'For Sales, help prepare a next action, follow-up draft or handoff checklist using supplied facts. Moving Sales stages does not accept a quote, schedule a visit or change job/compliance status.',
  ],
  council: [
    'Help draft factual resident communications, industry information sessions, campaign briefs, energy-upgrade explanations and council program checklists. Use the supplied audience, purpose and logistics; ask only for indispensable missing details. Do not invent dates, council endorsement, eligible rebates, attendance or measured results.',
    'Explain supplied report rows and their scope/date, including the difference between a count, estimate and proven outcome. Direct current-source or live-council checks to the council reporting workspace rather than claiming its data was read.',
  ],
  creditex: [
    'Help auditors organise supplied observations, explain a supplied form question, identify an apparent missing fact or draft neutral correction wording. Separate supplied evidence, inference and unknowns. Never invent evidence or an audit finding and never certify compliance, mark audited or approve a scheme claim.',
    'For record-grounded pre-review, guide the user to Jobs, the exact audit desk and Review with AI. That existing separate tool uses saved sources; this portal conversation does not inherit those records or its authority.',
  ],
};

// A conservative fast path for evident unrelated requests, not an allowlist for every
// trade or council question. Ambiguous requests still receive model-guided clarification.
const industryContext = /\b(?:solar|battery|batteries|heat[ -]?pump|hvac|air[ -]?con(?:ditioning)?|electric(?:al|ian)?|plumb(?:ing|er)?|install(?:er|ation|ing)?|rooftop|roofing|worksite|onsite|site safety|heat stress|energy (?:upgrade|assessment|efficiency)|fit[ -]?out|construction|trade safety)\b/i;
const workflowContext = /\b(?:draft|write|prepare|review|explain|check|summari[sz]e)\b[\s\S]{0,100}\b(?:quote|invoice|form|audit|customer (?:email|message)|inspection|council (?:campaign|program|session)|outreach)\b|\b(?:quote|invoice|form|audit|inspection|council campaign|council program|outreach|site visit)\b[\s\S]{0,80}\b(?:for|about|because|due|plan|safety|message|delay|postpone|reschedule)\b/i;
export function wattzunOffTopicReply(message: string, history: readonly WattzunTurn[], portal: WattzunPortal): WattzunReply | null {
  const text=message.normalize('NFKC').trim();
  const food=/\b(?:recommend|find|book|suggest|best|good|where|what)\b[\s\S]{0,100}\b(?:restaurant|restaurants|cafe|cafes|takeaway|pizza|recipe|recipes)\b|\b(?:restaurant|restaurants|cafe|cafes)\b[\s\S]{0,60}\b(?:near me|dinner|lunch|tonight)\b/i.test(text);
  const weather=/\bweather(?: forecast)?\b|\b(?:will it|is it going to)\s+(?:rain|snow)\b|\bforecast\s+(?:for\s+)?(?:today|tomorrow|tonight|this weekend)\b/i.test(text);
  const entertainment=/\b(?:recommend|suggest|watch|what|best|who won|tell me|give me)\b[\s\S]{0,100}\b(?:movie|movies|film|films|netflix|tv show|song|songs|music|joke|horoscope|football|cricket|celebrity)\b|\b(?:celebrity gossip|horoscope|sports score)\b/i.test(text);
  if (!food&&!weather&&!entertainment) return null;
  const related=industryContext.test(text)||workflowContext.test(text);
  const recentUser=history.filter(turn=>turn.role==='user').at(-1)?.content||'';
  // A short weather follow-up can retain an established site-planning context.
  const relatedWeatherFollowup=weather&&!food&&!entertainment&&(industryContext.test(recentUser)||workflowContext.test(recentUser));
  if (related||relatedWeatherFollowup) return null;
  const topic=food?'restaurant and food recommendations':weather?'general weather forecasts':'unrelated entertainment';
  return {kind:'answer',message:`Wattzun helps with TLink work, trade and energy questions, site forms, audits and council programs. I can’t help with ${topic} here. Tell me what you’re working on and I’ll help with the next step.`,questions:[],links:[{label:WATTZUN_PORTAL_GUIDE[portal][0].label,href:WATTZUN_PORTAL_GUIDE[portal][0].href}]};
}
