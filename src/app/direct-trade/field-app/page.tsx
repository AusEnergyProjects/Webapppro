import type { Metadata } from "next";
import Image from "next/image";

import { FieldAppDownload } from "@/components/FieldAppDownload";
import styles from "@/components/FieldAppDownload.module.css";

export const metadata: Metadata = {
  title: "TLink app",
  description: "Install and update the TLink field app for technicians, trades and assessors.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    noimageindex: true,
    nosnippet: true,
  },
};

export default function FieldAppPage() {
  return <main className={styles.page}>
    <header className={styles.header}><Image src="/tlink-icon-192.png" alt="" width={56} height={56} /><div><h1>Get TLink</h1><p>Your team and your work, together.</p></div></header>
    <FieldAppDownload />
    <p className={styles.footer}>Your business and saved permissions stay the same on every device.</p>
  </main>;
}