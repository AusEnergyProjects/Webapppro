"use client";

import { useEffect, useState } from "react";

type ReleasePolicy = { latestVersion?: string; updateUrl?: string };

export function FieldAppDownload() {
  const [policy, setPolicy] = useState<ReleasePolicy | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void fetch("/api/field/app-release?platform=android", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { policy?: ReleasePolicy };
        if (!response.ok || !body.policy) throw new Error("release unavailable");
        if (active) setPolicy(body.policy);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  const candidateUrl = String(policy?.updateUrl || "");
  let url = "";
  try {
    const parsed = new URL(candidateUrl);
    if (parsed.protocol === "https:") url = parsed.toString();
  } catch { /* a release URL must be absolute HTTPS */ }
  const isDirectDownload = Boolean(url && !url.endsWith("/direct-trade/field-app"));
  if (isDirectDownload) return <a className="btn" href={url}>Download Android test build {policy?.latestVersion || ""}</a>;
  return <span className="tlink-field-download-pending">{failed ? "Release check unavailable" : policy ? "Android test build link pending" : "Checking Android release..."}</span>;
}
