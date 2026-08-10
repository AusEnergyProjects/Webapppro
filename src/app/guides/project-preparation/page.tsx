import { GuideSection, GuideShell } from "@/components/GuideShell";

const evidenceFirst = [
  "The comfort, safety or equipment problem in plain language",
  "What is already installed and what is known or still uncertain",
  "Photos that can be taken safely from normal living areas",
  "Recent energy bills or interval data only when they are relevant",
  "Property, strata, rental and approval constraints",
  "A written scope with exclusions before comparing quotes",
];

export const metadata = {
  title: "Home Energy Project Preparation | Australian Energy Assessments",
  description:
    "Understand urgent, permission and budget requirements before progressing a brand-agnostic Australian home energy project.",
};

export default function ProjectPreparationGuidePage() {
  return (
    <GuideShell
      label="Project preparation guide"
      title="Know what each project step needs before you continue"
      introduction="Use these checks to decide what evidence, permission and scope is needed. The budget bands organise a plan; they are not market-price estimates, quotes or savings promises."
    >
      <div id="evidence-first">
        <GuideSection
          eyebrow="Start with evidence"
          title="Prepare facts before choosing a product or provider"
        >
          <ul className="guide-checklist">
            {evidenceFirst.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>
            Record whether each important fact is customer-reported, has a photo
            available for review, has a document available for review or is still
            unknown. This source label does not prove that a file is attached,
            linked to that fact or verified by Australian Energy Assessments or a trade.
          </p>
        </GuideSection>
      </div>

      <div id="climate-planning">
        <GuideSection
          eyebrow="Broad postcode planning"
          title="Use climate context to order investigations, not to size equipment"
        >
          <p>
            A broad postcode and state profile can help decide whether shade,
            airflow, draughts, insulation or system checks should come first. It
            is an approximate planning guide, not a NatHERS climate zone, home
            energy rating, site assessment, savings estimate or equipment-size
            calculation.
          </p>
        </GuideSection>
      </div>

      <div id="room-comfort">
        <GuideSection
          eyebrow="Room-by-room comfort"
          title="Add only the rooms where time and symptoms change the advice"
        >
          <p>
            Record controlled room types, when each room matters and whether it
            is too hot, too cold, draughty, damp, glary, stuffy or uneven. A
            private room nickname can help you recognise it later, but that name
            does not enter the anonymised installer scope.
          </p>
        </GuideSection>
      </div>

      <div id="urgent-replacement">
        <GuideSection
          eyebrow="Urgent replacement"
          title="Make the situation safe, then define the minimum complete scope"
        >
          <div className="guide-two-column">
            <div>
              <h3>What to record</h3>
              <p>
                Record the failed equipment, the rooms or services it supported,
                visible model details, current fuel or circuit, and any safety
                issue. Do not open covers or enter unsafe areas for a photo.
              </p>
            </div>
            <div>
              <h3>What to ask for</h3>
              <p>
                Ask a suitably licensed trade to separate the replacement,
                electrical or plumbing enabling work, removal, commissioning,
                warranties and exclusions. Compare a suitable efficient option
                as well as a like-for-like replacement where time allows.
              </p>
            </div>
          </div>
        </GuideSection>
      </div>

      <div id="permissions">
        <GuideSection
          eyebrow="Owner, renter and strata"
          title="Confirm who can approve the change before requesting fixed work"
        >
          <div className="guide-two-column">
            <div>
              <h3>Portable or reversible measures</h3>
              <p>
                Renters can often begin with clothing and bedding layers,
                electric throws, draught snakes, removable window films or
                coverings, portable fans and suitable portable induction
                cooking. Follow product and electrical safety instructions.
              </p>
            </div>
            <div>
              <h3>Fixed or shared-property work</h3>
              <p>
                Written owner, strata or owners-corporation approval may be
                needed for sealing, insulation, glazing, external shading,
                switchboard work, fixed appliances, outdoor units, solar,
                batteries or EV charging. Confirm the exact proposal, drawings,
                licensed trade and reinstatement obligations.
              </p>
            </div>
          </div>
          <p>
            The project permission checklist separates portable actions,
            permission requests, fixed or shared-property work and items that
            still need confirmation. It is a planning checklist, not legal or
            strata approval advice.
          </p>
        </GuideSection>
      </div>

      <div id="budget-under-2k">
        <GuideSection
          eyebrow="Budget under $2,000"
          title="Use the first stage to remove uncertainty and improve low-cost constraints"
        >
          <p>
            Prioritise safety, bills and usage evidence, comfort mapping,
            controls, maintenance and reversible measures. Obtain a site-specific
            quote before assuming fixed draught-proofing, electrical, glazing or
            insulation work fits this band.
          </p>
        </GuideSection>
      </div>

      <div id="budget-2-10k">
        <GuideSection
          eyebrow="Budget $2,000 to $10,000"
          title="Choose a small number of compatible measures after the main constraint is known"
        >
          <p>
            Use evidence to decide whether the first spend belongs in the
            building fabric, controls, electrical enabling work or one major
            appliance. Require current itemised quotes, exclusions and a
            contingency instead of relying on a generic online price.
          </p>
        </GuideSection>
      </div>

      <div id="budget-10k-plus">
        <GuideSection
          eyebrow="Budget above $10,000"
          title="Coordinate the whole-home sequence before committing"
        >
          <p>
            Review moisture and ventilation, insulation and glazing, electrical
            capacity, equipment sizing, solar and future loads together. Stage
            the work so an early installation does not obstruct a later one,
            and treat the budget as a ceiling until site-specific quotes are
            compared.
          </p>
        </GuideSection>
      </div>

      <section className="guide-callout">
        <div>
          <h2>Need building-fabric detail?</h2>
          <p>
            Review insulation, draught-proofing, glazing, shading, ventilation,
            moisture and electrical safety before defining trade scopes.
          </p>
        </div>
        <a href="/guides/insulation-draught-proofing">
          Open the building-fabric guide
        </a>
      </section>
    </GuideShell>
  );
}
