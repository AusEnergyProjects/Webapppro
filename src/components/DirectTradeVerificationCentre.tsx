"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { SiteFooter } from "./ComparatorChrome";
import { TLinkHeader } from "./TLinkChrome";

type VerificationProfile = {
  businessName: string;
  partnerType: "installer" | "supplier";
  verificationStatus: string;
  addressLine1: string;
  suburb: string;
  addressState: string;
  postcode: string;
};

type EvidenceDocument = {
  id: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  expiryDate: string;
  status: string;
  createdAt: string;
};

const installerChecks = [
  { category: "business-registration", title: "Legal business identity", text: "Confirm the contracting business and private business address. Personal identity is not requested here." },
  { category: "trade-licence", title: "Trade licence or registration", text: "Add the licence or registration relevant to each regulated work category." },
  { category: "insurance", title: "Insurance", text: "Add current cover appropriate to the work and service area." },
  { category: "scheme-approval", title: "Scheme-specific approval", text: "Add any installer approval required for certificates, rebates or program participation." },
];

const supplierChecks = [
  { category: "business-registration", title: "Legal business identity", text: "Confirm the supplying business and private business address. Personal identity is not requested here." },
  { category: "product-compliance", title: "Product compliance evidence", text: "Add relevant model certifications and installation conditions." },
  { category: "warranty", title: "Warranty pathway", text: "Add written warranty terms and the claim handling pathway." },
  { category: "australian-support", title: "Australian technical support", text: "Add evidence of local support, replacement pathways and escalation contacts." },
];

function statusLabel(value: string) {
  if (value === "approved") return "Approved";
  if (value === "submitted") return "Submitted for review";
  if (value === "evidence_started") return "Evidence started";
  return "Not started";
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function DirectTradeVerificationCentre() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<VerificationProfile | null>(null);
  const [documents, setDocuments] = useState<EvidenceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => onAuthStateChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
    if (!nextUser) setLoading(false);
  }), []);

  const authorisedFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!user) throw new Error("Sign in to continue.");
    const token = await user.getIdToken();
    return fetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const [profileResponse, documentsResponse] = await Promise.all([
          authorisedFetch("/api/trade-profile"),
          authorisedFetch("/api/trade-verification/documents"),
        ]);
        const profileResult = await profileResponse.json().catch(() => ({}));
        const documentsResult = await documentsResponse.json().catch(() => ({}));
        if (!profileResponse.ok) throw new Error(profileResult.error || "The verification centre could not be loaded.");
        if (!documentsResponse.ok) throw new Error(documentsResult.error || "Verification documents could not be loaded.");
        if (!cancelled) {
          setProfile(profileResult.profile || null);
          setDocuments(documentsResult.documents || []);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "The verification centre could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [user, authorisedFetch]);

  const checks = profile?.partnerType === "supplier" ? supplierChecks : installerChecks;
  const categoryLabels = useMemo(() => new Map(checks.map((check) => [check.category, check.title])), [checks]);

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!file || !category) {
      setError("Choose an evidence category and document.");
      return;
    }
    setSaving(true);
    try {
      const body = new FormData();
      body.set("category", category);
      body.set("expiryDate", expiryDate);
      body.set("file", file);
      const response = await authorisedFetch("/api/trade-verification/documents", { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The document could not be uploaded.");
      setDocuments((current) => [result.document, ...current]);
      setProfile((current) => current ? { ...current, verificationStatus: current.verificationStatus === "approved" ? "approved" : "evidence_started" } : current);
      setCategory("");
      setExpiryDate("");
      setFile(null);
      event.currentTarget.reset();
      setNotice("Document stored privately in your verification workspace.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The document could not be uploaded.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadDocument(document: EvidenceDocument) {
    setError("");
    try {
      const response = await authorisedFetch(`/api/trade-verification/documents?download=${encodeURIComponent(document.id)}`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "The document could not be downloaded.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The document could not be downloaded.");
    }
  }

  async function deleteDocument(document: EvidenceDocument) {
    if (!window.confirm(`Remove ${document.fileName} from this verification workspace?`)) return;
    setError("");
    try {
      const response = await authorisedFetch(`/api/trade-verification/documents?id=${encodeURIComponent(document.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The document could not be removed.");
      const next = documents.filter((item) => item.id !== document.id);
      setDocuments(next);
      if (!next.length) setProfile((current) => current && !["approved", "submitted"].includes(current.verificationStatus) ? { ...current, verificationStatus: "not_started" } : current);
      setNotice("Document removed from private storage.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The document could not be removed.");
    }
  }

  return <main className="wrap direct-trade-verification-page">
    <TLinkHeader active="verification" />
    {!authReady || loading ? <section className="dashboard-state-card" aria-live="polite"><p>Preparing the verification centre...</p></section> : !user ? <section className="dashboard-state-card"><span>Account required</span><h1>Sign in to manage verification</h1><p>Verification evidence belongs to the signed-in business account.</p><a className="btn" href="/direct-trade/partners">Sign in or create an account</a></section> : error && !profile ? <section className="dashboard-state-card"><span>Verification unavailable</span><h1>We could not load this account</h1><p>{error}</p><a className="btn" href="/direct-trade/dashboard">Return to dashboard</a></section> : !profile ? <section className="dashboard-state-card"><span>Profile required</span><h1>Complete the business profile first</h1><p>The private business address and role determine the correct verification pathway.</p><a className="btn" href="/direct-trade/partners">Complete business profile</a></section> : <>
      <header className="verification-hero"><div><span>Verification centre</span><h1>Prepare {profile.businessName} for review</h1><p>Store role-specific evidence in a private workspace for future Australian Energy Assessments review. Uploading a document does not grant approval or replace an issuing authority.</p></div><aside><span>Current status</span><strong>{statusLabel(profile.verificationStatus)}</strong><small>{documents.length} {documents.length === 1 ? "document" : "documents"} stored privately. Review submission will open in a later release.</small></aside></header>
      <nav className="dashboard-subnav" aria-label="TLink account"><a href="/direct-trade/dashboard">Overview</a><a aria-current="page" href="/direct-trade/dashboard/verification">Verification centre</a><a href="/direct-trade/membership">Membership and referrals</a></nav>
      <section className="verification-summary" aria-label="Business verification summary"><article><span>Business</span><strong>{profile.businessName}</strong><small>{profile.suburb}, {profile.addressState} {profile.postcode}</small></article><article><span>Role pathway</span><strong>{profile.partnerType === "supplier" ? "Supplier or wholesaler" : "Licensed installer"}</strong><small>Evidence categories change with role and work category.</small></article><article><span>Privacy</span><strong>Owner-only access</strong><small>No public file links. Downloads require this signed-in account.</small></article></section>
      <section className="dashboard-panel verification-checklist" aria-labelledby="verification-checklist-title"><div className="dashboard-panel-heading"><span>Evidence pathway</span><h2 id="verification-checklist-title">What the review will confirm</h2><p>Add only evidence relevant to the business role and proposed work.</p></div><div>{checks.map((check, index) => { const count = documents.filter((document) => document.category === check.category).length; return <article key={check.category}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{check.title}</h3><p>{check.text}</p></div><strong>{count ? `${count} uploaded` : "Not added"}</strong></article>; })}</div></section>
      <section className="verification-workspace" aria-labelledby="verification-upload-title">
        <form className="verification-upload" onSubmit={uploadDocument}>
          <div className="dashboard-panel-heading"><span>Private evidence upload</span><h2 id="verification-upload-title">Add a document</h2><p>PDF, JPEG or PNG only, up to 8 MB. Do not upload personal identity records unless Australian Energy Assessments requests them separately.</p></div>
          <label>Evidence category<select value={category} onChange={(event) => setCategory(event.target.value)} required><option value="">Choose a category</option>{checks.map((check) => <option value={check.category} key={check.category}>{check.title}</option>)}</select></label>
          <label>Expiry date <small>optional</small><input type="date" value={expiryDate} onChange={(event) => setExpiryDate(event.target.value)} /></label>
          <label className="verification-file">Document<input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0] || null)} required /><small>{file ? `${file.name} (${formatBytes(file.size)})` : "Choose one PDF, JPEG or PNG file"}</small></label>
          <button className="btn" type="submit" disabled={saving}>{saving ? "Uploading securely..." : "Store document privately"}</button>
          {notice ? <p className="verification-notice" role="status">{notice}</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
        <div className="verification-library">
          <div className="dashboard-panel-heading"><span>Evidence library</span><h2>Your stored documents</h2><p>Only this Firebase-authenticated business account can list, download or remove these files.</p></div>
          {!documents.length ? <div className="verification-empty"><strong>No documents stored</strong><p>Start with business registration evidence, then add the role-specific items you already hold.</p></div> : <div className="verification-document-list">{documents.map((document) => <article key={document.id}><div><span>{categoryLabels.get(document.category) || "Evidence"}</span><strong>{document.fileName}</strong><small>{formatBytes(document.sizeBytes)} · Uploaded {new Date(document.createdAt).toLocaleDateString("en-AU")}{document.expiryDate ? ` · Expires ${new Date(`${document.expiryDate}T00:00:00`).toLocaleDateString("en-AU")}` : ""}</small></div><div><button type="button" onClick={() => void downloadDocument(document)}>Download</button><button type="button" className="danger" onClick={() => void deleteDocument(document)}>Remove</button></div></article>)}</div>}
        </div>
      </section>
      <section className="verification-boundary"><div><span>Secure evidence boundary</span><h2>Private storage, no public document links</h2><p>Files use opaque storage keys, account ownership checks and authenticated downloads. Household users and public marketplace visitors cannot access this workspace. Australian Energy Assessments review access is not enabled in this release.</p></div><aside><strong>Keep evidence useful</strong><ul><li>Use current, legible business documents</li><li>Add expiry dates where relevant</li><li>Remove superseded versions</li><li>Keep personal identity records out unless requested</li></ul><a className="btn" href="/direct-trade/dashboard">Return to dashboard</a></aside></section>
    </>}
    <SiteFooter>Verification status is an Australian Energy Assessments marketplace control and does not replace confirmation with the relevant issuing authority.</SiteFooter>
  </main>;
}
