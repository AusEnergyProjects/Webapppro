import Image from "next/image";
import type {
  CustomerPlanReportAction,
  CustomerPlanReportView,
} from "@/lib/customer-plan-report";
import styles from "./CustomerPlanReportPreview.module.css";

function ReportHeading({
  eyebrow,
  title,
  intro,
  id,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  id?: string;
}) {
  return (
    <header className={styles.sectionHeading}>
      <span aria-hidden="true" className={styles.headingAccent} />
      <p>{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {intro && <div>{intro}</div>}
    </header>
  );
}

function ActionCard({
  action,
  priority,
}: {
  action: CustomerPlanReportAction;
  priority: boolean;
}) {
  return (
    <li
      className={`${styles.actionCard} ${
        priority ? styles.priorityAction : styles.roadmapAction
      }`}
    >
      <div className={styles.actionNumber} aria-hidden="true">
        {action.completed ? "Done" : String(action.number).padStart(2, "0")}
      </div>
      <div className={styles.actionContent}>
        <p className={styles.actionStage}>
          {priority ? `Start here | ${action.stage}` : action.stage}
        </p>
        <h3>{action.title}</h3>
        <p className={styles.actionDescription}>{action.description}</p>
        {action.guideHref && action.guideLabel && (
          <a href={action.guideHref} rel="noreferrer" target="_blank">
            {action.guideLabel}
          </a>
        )}
      </div>
    </li>
  );
}

export function CustomerPlanReportPreview({
  report,
}: {
  report: CustomerPlanReportView;
}) {
  const copy = report.copy;
  const planComplete = report.actions.length > 0
    && report.actions.every((action) => action.completed);
  const [leadSnapshot, ...remainingSnapshots] = report.planningSnapshot;
  const reportSignals = planComplete
    ? [
      [report.actions.length, "Steps complete"],
      [0, "Left to plan"],
      [report.questions.length, "Check first"],
    ]
    : [
      [report.priorityActions.length, "Start now"],
      [report.laterActions.length, "Plan next"],
      [report.questions.length, "Check first"],
    ];

  return (
    <article
      className={styles.report}
      data-aea-report-design={report.designVersion}
    >
      <header className={styles.hero}>
        <div className={styles.brandRow}>
          <div className={styles.brandLockup}>
            <span className={styles.logoTile}>
              <Image
                alt=""
                height={36}
                src="/api/aea-brandmark"
                unoptimized
                width={36}
              />
            </span>
            <span>
              <strong>{copy.brand}</strong>
              <small>Independent energy assessments</small>
            </span>
          </div>
          <time dateTime={report.preparedDate}>
            {report.displayDate || report.preparedDate}
          </time>
        </div>
        <div className={styles.heroContent}>
          <p>{copy.heroEyebrow}</p>
          <h1>{copy.heroTitle}</h1>
          <strong>{report.planTitle}</strong>
          {report.summary && <div>{report.summary}</div>}
        </div>
        <p className={styles.heroBoundary}>
          Independent | Brand neutral | Built around your home
        </p>
      </header>

      <div className={styles.body}>
        <section aria-labelledby="report-snapshot-title">
          <header className={styles.sectionHeading}>
            <span aria-hidden="true" className={styles.headingAccent} />
            <p>{copy.snapshotEyebrow}</p>
            <h2 id="report-snapshot-title">{copy.snapshotTitle}</h2>
          </header>

          {leadSnapshot && (
            <div className={styles.leadSnapshot}>
              <p>{leadSnapshot.label}</p>
              <strong>{leadSnapshot.value}</strong>
            </div>
          )}

          {remainingSnapshots.length > 0 && (
            <dl className={styles.snapshotGrid}>
              {remainingSnapshots.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <dl className={styles.signalGrid} aria-label="Plan progress">
            {reportSignals.map(([value, label]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {report.priorityActions.length > 0 && (
          <section
            className={styles.section}
            aria-labelledby="report-priority-title"
          >
            <header className={styles.sectionHeading}>
              <span aria-hidden="true" className={styles.headingAccent} />
              <p>{copy.startEyebrow}</p>
              <h2 id="report-priority-title">{copy.startTitle}</h2>
              <div>{copy.startIntro}</div>
            </header>
            <ol className={styles.actionList}>
              {report.priorityActions.map((action) => (
                <ActionCard action={action} key={action.id} priority />
              ))}
            </ol>
          </section>
        )}

        {report.laterActions.length > 0 && (
          <section
            className={styles.section}
            aria-labelledby="report-roadmap-title"
          >
            <header className={styles.sectionHeading}>
              <span aria-hidden="true" className={styles.headingAccent} />
              <p>
                {report.priorityActions.length
                  ? copy.roadmapEyebrow
                  : copy.completedEyebrow}
              </p>
              <h2 id="report-roadmap-title">
                {report.priorityActions.length
                  ? copy.roadmapTitle
                  : copy.completedTitle}
              </h2>
              <div>
                {report.priorityActions.length
                  ? copy.roadmapIntro
                  : copy.completedIntro}
              </div>
            </header>
            <ol className={styles.actionList}>
              {report.laterActions.map((action) => (
                <ActionCard
                  action={action}
                  key={action.id}
                  priority={false}
                />
              ))}
            </ol>
          </section>
        )}

        {report.everydayActions.length > 0 && (
          <section
            className={styles.section}
            aria-labelledby="report-everyday-title"
          >
            <ReportHeading
              eyebrow={copy.everydayEyebrow}
              id="report-everyday-title"
              intro={copy.everydayIntro}
              title={copy.everydayTitle}
            />
            <div className={styles.everydayPanel}>
              <div className={styles.everydayGrid}>
                {report.everydayActions.map((action) => (
                  <article key={action.id}>
                    <p>{action.category}</p>
                    <h3>{action.title}</h3>
                    <div>{action.description}</div>
                  </article>
                ))}
              </div>
              <p className={styles.panelBoundary}>
                {report.everydayActionsBoundary}
              </p>
            </div>
          </section>
        )}

        {report.climate && (
          <section
            className={`${styles.section} ${styles.featurePanel}`}
            aria-labelledby="report-climate-title"
          >
            <p>{copy.climateEyebrow}</p>
            <h2 id="report-climate-title">{report.climate.label}</h2>
            <div>{report.climate.summary}</div>
          </section>
        )}

        <section
          className={styles.section}
          aria-labelledby="report-readiness-title"
        >
          <ReportHeading
            eyebrow={copy.readinessEyebrow}
            id="report-readiness-title"
            title="How confident is this plan?"
          />
          <div
            className={`${styles.readinessPanel} ${
              report.questions.length ? styles.needsReview : styles.isReady
            }`}
          >
            <h3>
              {report.readinessPresentation.title}
            </h3>
            <p>{report.readinessPresentation.body}</p>
            {report.questions.length > 0 && (
              <ol>
                {report.questions.map((question) => (
                  <li key={question.number}>
                    <strong>{question.prompt}</strong>
                    <span>{question.whyItMatters}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {report.professionalPresentation && (
            <aside className={styles.professionalPanel}>
              <p>{report.professionalPresentation.eyebrow}</p>
              <h3>{report.professionalPresentation.title}</h3>
              <div>
                {[
                  report.professionalPresentation.role,
                  report.professionalPresentation.scheme,
                  report.professionalPresentation.reference,
                ].filter(Boolean).join(" | ")}
              </div>
              {report.professionalPresentation.notes && (
                <blockquote>
                  <strong>Adviser note</strong>
                  <p>{report.professionalPresentation.notes}</p>
                </blockquote>
              )}
              <small>{report.professionalPresentation.boundary}</small>
            </aside>
          )}
        </section>

        <section
          className={styles.section}
          aria-labelledby="report-basis-title"
        >
          <ReportHeading
            eyebrow={copy.whyEyebrow}
            id="report-basis-title"
            title={copy.whyTitle}
          />
          <div className={styles.basisPanel}>
            <ul>
              {report.decisionBasis.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
          <aside className={styles.reviewPanel}>
            <strong>When to review this plan</strong>
            <p>{report.changeBoundary}</p>
          </aside>
        </section>

        <section
          className={styles.section}
          aria-labelledby="report-trade-title"
        >
          <ReportHeading
            eyebrow={copy.tradeEyebrow}
            id="report-trade-title"
            title={copy.tradeTitle}
          />
          <div className={styles.tradePanel}>
            <ul>
              {report.beforeTrade.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>

        <section
          aria-labelledby="report-privacy-title"
          className={`${styles.section} ${styles.privacyPanel}`}
        >
          <p>{copy.privacyEyebrow}</p>
          <h2 id="report-privacy-title">{copy.privacyTitle}</h2>
          <div>{report.privacyNote}</div>
          <small>{report.adviceBoundary}</small>
        </section>
      </div>

      <footer className={styles.reportFooter}>
        <span>{copy.footer}</span>
        <span>Prepared {report.displayDate || report.preparedDate}</span>
      </footer>
    </article>
  );
}
