"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import styles from "./QuickUpgradeEnquiry.module.css";

const QuickUpgradeEnquiryDialog = dynamic(
  () => import("./QuickUpgradeEnquiryDialog").then((module) => module.QuickUpgradeEnquiryDialog),
  { ssr: false },
);

export function QuickUpgradeEnquiry() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={`${styles.openButton} btn start-primary-action`}
        id="quick-upgrade-options"
        type="button"
        onClick={() => setOpen(true)}
      >
        Get independent upgrade options
      </button>
      {open ? <QuickUpgradeEnquiryDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
