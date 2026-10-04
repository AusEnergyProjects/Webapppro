import type { ReactNode } from "react";
import styles from "./CouncilWorkspace.module.css";

export type CouncilIconName = "overview" | "activity" | "business" | "campaign" | "report" | "settings" | "calendar" | "arrow" | "download" | "plus" | "external" | "check" | "shield" | "leaf" | "map" | "copy" | "refresh" | "logout" | "sun" | "moon" | "users" | "community" | "search" | "close" | "calculator";

export function CouncilIcon({ name, size = 20 }: { name: CouncilIconName; size?: number }) {
  const paths: Record<CouncilIconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
    business: <><path d="M4 21V8l8-5 8 5v13M2 21h20M9 21v-6h6v6M8 9h1m6 0h1M8 12h1m6 0h1" /></>,
    campaign: <><path d="m3 10 12-5v14L3 14v-4ZM15 8l4-3m-4 11 4 3M6 15l2 6h3l-2-5M20 10v4" /></>,
    report: <><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 17v-3m4 3v-6m4 6v-4" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    plus: <path d="M12 5v14M5 12h14" />,
    external: <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    leaf: <><path d="M20 3C9 2 3 6 4 13c1 6 8 8 12 4 3-3 4-8 4-14ZM5 20 16 9" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" /></>,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>,
    logout: <><path d="M9 4H4v16h5m4-8h8m-4-4 4 4-4 4" /></>,
    sun: <><circle cx="12" cy="12" r="3.25" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
    moon: <path d="M20.4 15.1A8.7 8.7 0 0 1 8.9 3.6 8.8 8.8 0 1 0 20.4 15.1Z" />,
    users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v3" /></>,
    community: <><path d="M3 21V11l6-4 6 4v10M1 21h22M7 21v-6h4v6M15 7l3-2 3 2v14M17 10h1m-1 4h1M9 3v1" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    calculator: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M7 6h10M7 10h1m4 0h1m4 0h1M7 14h1m4 0h1m4 0h1M7 18h1m4 0h1m4-4v4" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export const councilNumber = (value: number | null | undefined) => value === null || value === undefined ? "Not available" : new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(value);
export const councilMoney = (cents: number | null | undefined, compact = false) => cents === null || cents === undefined ? "Not available" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: compact ? 1 : 0, notation: compact ? "compact" : "standard" }).format(cents / 100);
const councilMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function councilDateParts(value: string, timeZone: string) {
  // Calendar values carry no instant or time zone; preserve their stated date.
  const calendar = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (calendar) {
    const year = Number(calendar[1]), month = Number(calendar[2]), day = Number(calendar[3] || 1);
    const check = new Date(`${calendar[1]}-${calendar[2]}-${String(day).padStart(2, "0")}T00:00:00Z`);
    return Number.isFinite(check.getTime()) && check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day ? { year, month, day, hour: 0, minute: 0 } : null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === name)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

// Build labels ourselves: ICU versions disagree on short months such as Jun/June.
export function councilMonth(value: string, timeZone = "Australia/Melbourne") {
  const parts = councilDateParts(value, timeZone);
  return parts ? `${councilMonths[parts.month - 1]} ${parts.year}` : "Not available";
}

export function councilDate(value: string, timeZone = "Australia/Melbourne") {
  const parts = councilDateParts(value, timeZone);
  return parts ? `${parts.day} ${councilMonths[parts.month - 1]} ${parts.year}` : "Not available";
}

export function councilDateTime(value: string, timeZone = "Australia/Melbourne") {
  const parts = councilDateParts(value, timeZone);
  return parts ? `${parts.day} ${councilMonths[parts.month - 1]} ${parts.year}, ${parts.hour % 12 || 12}:${String(parts.minute).padStart(2, "0")} ${parts.hour < 12 ? "am" : "pm"} (${timeZone})` : "Not available";
}

export function CouncilPanel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`${styles.panel} ${className}`}><header className={styles.panelHeader}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>;
}

export function CouncilEmpty({ title, children, icon = "activity" }: { title: string; children: ReactNode; icon?: CouncilIconName }) {
  return <div className={styles.empty}><span className={styles.emptyIcon}><CouncilIcon name={icon} size={25} /></span><h3>{title}</h3><p>{children}</p></div>;
}

export function CouncilMetric({ label, value, detail, icon, accent = false }: { label: string; value: string; detail: string; icon: CouncilIconName; accent?: boolean }) {
  return <article className={`${styles.metric} ${accent ? styles.metricAccent : ""}`}><div className={styles.metricLabel}><span>{label}</span><CouncilIcon name={icon} size={19} /></div><strong>{value}</strong><p>{detail}</p></article>;
}

export function CouncilPill({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={muted ? styles.pillMuted : styles.pill}>{children}</span>;
}
