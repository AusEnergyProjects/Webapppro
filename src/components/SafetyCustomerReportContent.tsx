/* eslint-disable @next/next/no-img-element */

import { safetyReportDate, safetyReportHighlights, type SafetyCustomerReport } from '@/lib/safety-customer-report';
import styles from './SafetyCustomerReport.module.css';

const displayedValue = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? safetyReportDate(value) : value;

function EvidenceGallery({ report }: { report: SafetyCustomerReport }) {
  return <div className={styles.gallery}>{report.evidence.map(item => <article key={item.id} className={styles.evidence}>
    <a className={styles.evidencePreview} href={item.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer" aria-label={`Open ${item.label || item.fileName}`}>
      {item.contentType.startsWith('image/') ? <img src={item.url} alt={item.label || item.fileName} loading="lazy" referrerPolicy="no-referrer" width="480" height="360" />
        : <div className={styles.documentPreview} aria-hidden="true"><span>PDF</span><small>Supporting record</small></div>}
    </a>
    <div><strong>{item.label || item.fileName}</strong><span>{item.fileName}</span><div className={styles.evidenceActions}><a href={item.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">{item.contentType.startsWith('image/') ? 'Open photo' : 'Open document'} <span aria-hidden="true">↗</span></a><a href={item.url} download={item.fileName} rel="noreferrer" referrerPolicy="no-referrer" aria-label={`Save ${item.label || item.fileName}`}>Save copy <span aria-hidden="true">↓</span></a></div></div>
  </article>)}</div>;
}

export function SafetyCustomerReportContent({ report }: { report: SafetyCustomerReport }) {
  const highlights = safetyReportHighlights(report), photos = report.evidence.filter(item => item.contentType.startsWith('image/'));
  const resultTone = report.outcome?.attention === 'urgent' ? styles.urgent : report.outcome?.attention === 'follow_up' ? styles.caution : styles.neutral;
  return <main id="site-content" className={styles.page}>
    <div className={styles.wrap}>
      <header className={styles.topbar}>
        <div className={styles.businessBrand}>{report.business.logoUrl && <img src={report.business.logoUrl} alt={`${report.business.name} logo`} referrerPolicy="no-referrer" width="160" height="64" onError={event => { event.currentTarget.hidden = true; }} />}<div><strong>{report.business.name}</strong><span>Your property safety report</span></div></div>
        <div className={styles.tlinkBrand}><img src="/tlink-icon-192.png" alt="TLink" width="38" height="38" /><span>Prepared with <strong>TLink</strong></span></div>
      </header>

      <section className={styles.hero} aria-labelledby="report-title">
        <div className={styles.heroText}><span className={styles.eyebrow}>YOUR CHECK. YOUR RECORDS.</span><h1 id="report-title">{report.title}</h1><p className={styles.address}>{report.propertyAddress}</p><p className={styles.recordNumber}>{report.recordNumber}</p></div>
        <a href={report.pdfUrl} className={styles.primaryButton} download rel="noreferrer" referrerPolicy="no-referrer"><span aria-hidden="true">↓</span> Download official PDF</a>
        <dl className={styles.facts}><div><dt>Checked on</dt><dd>{safetyReportDate(report.inspectionDate)}</dd></div><div><dt>Checked by</dt><dd>{report.inspectorName}</dd></div><div><dt>Record completed</dt><dd>{safetyReportDate(report.completedAt)}</dd></div><div><dt>Evidence photos</dt><dd>{photos.length}</dd></div></dl>
      </section>

      <nav className={styles.jumpNav} aria-label="Report sections"><a href="#recorded-findings">Findings</a><a href="#check-details">What was checked</a>{report.evidence.length > 0 && <a href="#report-evidence">Photos &amp; records</a>}<a href="#report-contact">Contact your inspector</a></nav>

      <section id="recorded-findings" className={styles.section} aria-labelledby="findings-title">
        <div className={styles.sectionHeading}><span className={styles.eyebrow}>THE INFORMATION THAT MATTERS</span><h2 id="findings-title">Your recorded findings</h2></div>
        {report.outcome && <div className={`${styles.result} ${resultTone}`}><span className={styles.resultLabel}>INSPECTOR&apos;S RECORDED RESULT</span><strong>{report.outcome.label}</strong>{report.outcome.attention === 'urgent' && <p>Follow the inspecting business&apos;s urgent instructions in the findings below.</p>}</div>}
        <div className={styles.findings}>{highlights.length ? highlights.map((item, index) => <article key={`${index}-${item.label}`}><h3>{item.label}</h3><p>{displayedValue(item.value)}</p></article>)
          : <p className={styles.help}>Read the recorded answers below and keep the official PDF with your property records.</p>}</div>
      </section>

      <section id="check-details" className={styles.section} aria-labelledby="checks-title">
        <div className={styles.sectionHeading}><span className={styles.eyebrow}>THE CHECK, IN DETAIL</span><h2 id="checks-title">What was checked</h2><p>Open any section to see the inspecting person&apos;s recorded answers.</p></div>
        <div className={styles.checkList}>{report.sections.map((section, index) => <details key={`${index}-${section.title}`} className={styles.checkSection} open={index === 0}>
          <summary><span className={styles.sectionNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span><strong>{section.title}</strong><small>{section.items.length} recorded {section.items.length === 1 ? 'answer' : 'answers'}</small></span><span className={styles.expandLabel}>View checks <span aria-hidden="true">+</span></span></summary>
          <dl className={styles.answers}>{section.items.map((item, itemIndex) => <div key={`${itemIndex}-${item.label}`}><dt>{item.label}</dt><dd>{displayedValue(item.value)}</dd></div>)}</dl>
        </details>)}</div>
      </section>

      {report.evidence.length > 0 && <section id="report-evidence" className={styles.section} aria-labelledby="evidence-title"><div className={styles.sectionHeading}><span className={styles.eyebrow}>EVERYTHING TOGETHER</span><h2 id="evidence-title">Photos &amp; supporting records</h2><p>Open a photo or document to view it in full and save a copy.</p></div><EvidenceGallery report={report} /></section>}

      <section id="report-contact" className={`${styles.section} ${styles.contactSection}`} aria-labelledby="contact-title">
        <div className={styles.contact}><div><span className={styles.eyebrow}>YOUR NEXT STEP</span><h2 id="contact-title">Questions about the check?</h2><p>Contact {report.business.name} about the recorded findings, repairs or follow-up work.</p><div className={styles.contactLinks}>{report.business.email && <a href={`mailto:${report.business.email}`}>{report.business.email}</a>}{report.business.phone && <a href={`tel:${report.business.phone.replace(/[^+\d]/g, '')}`}>{report.business.phone}</a>}</div></div><a href={report.pdfUrl} className={styles.primaryButton} download rel="noreferrer" referrerPolicy="no-referrer">Save your official PDF <span aria-hidden="true">↓</span></a></div>
        {report.signatures.length > 0 && <div className={styles.signatures}>{report.signatures.map((signature, index) => <div key={`${index}-${signature.name}`}><span>Signed by</span><strong>{signature.name}</strong><small>{signature.title} · {safetyReportDate(signature.signedAt)}</small></div>)}</div>}
      </section>
      <footer className={styles.footer}><p>This private report contains the inspecting person&apos;s recorded findings and conditions. Keep the official PDF and its supporting evidence together.</p><span>Delivered through TLink</span></footer>
    </div>
  </main>;
}
