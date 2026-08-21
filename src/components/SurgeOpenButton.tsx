"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { storePendingSurgeDraft } from "@/lib/surge-page-navigation";
import styles from "./SurgeOpenButton.module.css";

export function SurgeOpenButton({
  label,
  description,
  draft,
}: {
  label: string;
  description: string;
  draft: string;
}) {
  const router = useRouter();

  return (
    <Link
      className={styles.button}
      href="/surge"
      prefetch={false}
      onPointerEnter={() => router.prefetch("/surge")}
      onFocus={() => router.prefetch("/surge")}
      onClick={() => storePendingSurgeDraft(draft)}
    >
      <span className={styles.mascot} aria-hidden="true" />
      <span className={styles.copy}>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className={styles.arrow} aria-hidden="true">›</span>
    </Link>
  );
}
