export type BookingTrainingModule = { id: string; title: string };

/** Open learning separately so a blocked booking's entered details stay in place. */
export function BookingTrainingLinks({ modules, teamPortal = false }: { modules: BookingTrainingModule[]; teamPortal?: boolean }) {
  if (!modules.length) return null;
  const path = teamPortal ? "/direct-trade/team" : "/direct-trade/dashboard";
  return <div className="crm-status" role="note" aria-label="Required booking training">
    <strong>Required training</strong>
    <ul>{modules.map(module => <li key={module.id}><a href={`${path}?workspace=training&module=${encodeURIComponent(module.id)}`} target="_blank" rel="noreferrer">Open {module.title} (new tab)</a></li>)}</ul>
    <p>The person carrying out the work completes their own assessment. Your booking details stay open here while they complete it.</p>
  </div>;
}
