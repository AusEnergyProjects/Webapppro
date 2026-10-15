"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

const QuickUpgradeEnquiryDialog = dynamic(() => import("./QuickUpgradeEnquiryDialog").then((module) => module.QuickUpgradeEnquiryDialog), { ssr: false });

export function AeaServiceEnquiryButton({ serviceId, className, children = "Enquire about this service" }: { serviceId: string; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (serviceId === "minimum-rental-standards") return <Link href="/rental-assessment/request" className={className}>{children}</Link>;
  return <><button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>{open ? <QuickUpgradeEnquiryDialog initialServices={[serviceId]} onClose={() => setOpen(false)} /> : null}</>;
}
