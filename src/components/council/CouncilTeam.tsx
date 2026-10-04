"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CouncilApi } from "@/components/CouncilPortal";
import type { CouncilRole } from "@/lib/council-access-server";
import { applyCouncilDemoTeamAction, createCouncilDemoTeam, parseCouncilTeamAction, type CouncilTeam as Team, type CouncilTeamAction } from "@/lib/council-team";
import styles from "./CouncilTeam.module.css";

export type CouncilTeamProps = {
  councilId: string;
  demonstration: boolean;
  role: CouncilRole;
  api?: CouncilApi;
  /** Optional controlled practice state lets the portal preserve edits between views. */
  demoTeam?: Team;
  onDemoTeamChange?: (team: Team) => void;
};

export function CouncilTeam(props: CouncilTeamProps) {
  return <CouncilTeamContent key={`${props.demonstration ? "demo" : "live"}:${props.councilId}`} {...props} />;
}

function CouncilTeamContent({ councilId, demonstration, role, api, demoTeam, onDemoTeamChange }: CouncilTeamProps) {
  const [team, setTeam] = useState<Team | null>(() => demonstration ? demoTeam ?? { ...createCouncilDemoTeam(), councilId } : null);
  const [loading, setLoading] = useState(!demonstration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const generation = useRef(0);
  const shareInput = useRef<HTMLInputElement>(null);
  const currentTeam = demonstration && demoTeam ? demoTeam : team;
  const canManage = role === "owner" && currentTeam?.canManage;

  useEffect(() => {
    const current = ++generation.current;
    queueMicrotask(() => {
      if (current !== generation.current) return;
      setShareUrl(new URL(demonstration ? "/council/demo" : "/council", window.location.origin).href);
      if (!demonstration) { setLoading(true); setError(""); setTeam(null); }
      if (!demonstration) {
        if (!api) {
          setError("The council connection is unavailable. Reload the workspace."); setLoading(false);
        } else {
          void api<{ team: Team }>(`/api/council/team?councilId=${encodeURIComponent(councilId)}`)
            .then(result => { if (current === generation.current) { setTeam(result.team); setLoading(false); } })
            .catch(failure => { if (current === generation.current) { setError(failure instanceof Error ? failure.message : "The team could not be loaded."); setLoading(false); } });
        }
      }
    });
    return () => { generation.current = current + 1; };
  }, [api, councilId, demonstration, refresh]);

  async function act(input: CouncilTeamAction) {
    if (busy || !currentTeam || !canManage) return false;
    const current = generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const clean = parseCouncilTeamAction(input);
      const updated = demonstration ? applyCouncilDemoTeamAction(currentTeam, clean)
        : api ? (await api<{ team: Team }>(`/api/council/team?councilId=${encodeURIComponent(councilId)}`, { method: "POST", body: JSON.stringify(clean) })).team
          : null;
      if (current !== generation.current) return false;
      if (!updated) throw new Error("The council connection is unavailable. Reload the workspace.");
      setTeam(updated);
      if (demonstration) onDemoTeamChange?.(updated);
      setConfirmRemoval("");
      setNotice(clean.action === "invite" ? (demonstration ? "Practice invitation created. No live access was granted." : "Invitation created. Share the sign-in link with your colleague.")
        : clean.action === "revoke" ? "Access removed." : clean.action === "restore" ? "Access restored." : "Role updated.");
      return true;
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "The team change could not be saved.");
      return false;
    } finally { if (current === generation.current) setBusy(false); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invited = email.trim().toLowerCase();
    if (await act({ action: "invite", email, displayName: name, role: inviteRole })) {
      setInvitedEmail(invited); setName(""); setEmail(""); setInviteRole("viewer");
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(shareUrl); setNotice(demonstration ? "Demonstration link copied. This link does not grant live access." : "Council sign-in link copied."); }
    catch { shareInput.current?.focus(); shareInput.current?.select(); setNotice("Select and copy the invitation link below."); }
  }

  const members = currentTeam?.members ?? [];
  const active = members.filter(member => member.status === "active");
  return <div className={styles.layout}>
    <div className={styles.heading}><div><h2>Your council team</h2><p>Give colleagues the access they need to support your community programs.</p></div><button className={styles.secondary} type="button" disabled={loading || busy} onClick={() => { setNotice(""); setRefresh(value => value + 1); }}>Refresh team</button></div>
    {demonstration && <p className={styles.note}>Practice team management with fictional members. Invitations here do not create accounts or grant live access.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.note} role="status">{notice}</p>}
    {loading && <p className={styles.note} role="status">Loading your council team...</p>}
    {!loading && currentTeam && <>
      <div className={styles.stats}><div><strong>{active.filter(member => !member.pending).length}</strong><span>People with access</span></div><div><strong>{active.filter(member => member.pending).length}</strong><span>Awaiting sign-in</span></div><div><strong>{active.filter(member => member.role === "owner" && !member.pending).length}</strong><span>Workspace owners</span></div></div>
      {canManage ? <form className={styles.invite} onSubmit={event => void invite(event)}>
        <div><h3>Invite a colleague</h3><p>They will sign in with this email and verify it. No email is sent automatically.</p></div>
        <fieldset disabled={busy}><label>Name <span>(optional)</span><input value={name} onChange={event => setName(event.target.value)} maxLength={120} autoComplete="off" placeholder="Colleague's name" /></label><label>Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} maxLength={254} autoComplete="off" placeholder="colleague@council.gov.au" /></label><label>Access<select value={inviteRole} onChange={event => setInviteRole(event.target.value === "editor" ? "editor" : "viewer")}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label><button type="submit" className={styles.primary}>{busy ? "Saving..." : "Create invitation"}</button></fieldset>
      </form> : <p className={styles.note}>You can see your council team. An owner can invite colleagues and change access.</p>}
      {canManage && (invitedEmail || active.some(member => member.pending)) && <div className={styles.share}><div><strong>{invitedEmail ? `Invitation ready for ${invitedEmail}` : "Share the council sign-in link"}</strong><p>{demonstration ? "This practice link opens the demonstration. It does not invite anyone to a real workspace." : "Share this link yourself. Only the invited, verified email address receives access; forwarding the link grants no access."}</p></div><div className={styles.shareControls}><input ref={shareInput} aria-label="Council invitation link" value={shareUrl} readOnly onFocus={event => event.target.select()} /><button type="button" className={styles.secondary} disabled={!shareUrl} onClick={() => void copyLink()}>Copy link</button></div></div>}
      <section className={styles.roster} aria-label="Council team members">
        <div className={styles.rosterHeading}><h3>Team members</h3><span>{members.length} total</span></div>
        {members.map(member => <article className={styles.member} key={member.id}>
          <div className={styles.person}><span className={styles.avatar} aria-hidden="true">{(member.displayName || member.email).slice(0, 1).toUpperCase()}</span><div><strong>{member.displayName || member.email}{member.isSelf && <small> You</small>}</strong><span>{member.email}</span><span className={styles.status}>{member.status === "suspended" ? "Access removed" : member.pending ? "Invited, awaiting verified sign-in" : "Active"}</span></div></div>
          <div className={styles.memberActions}>
            {canManage && !member.isSelf && member.status === "active" ? <label className={styles.roleLabel}><span className={styles.srOnly}>Role for {member.email}</span><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={event => { const next = event.target.value; if (next === "owner" || next === "editor" || next === "viewer") void act({ action: "role", membershipId: member.id, role: next }); }}><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="owner">Owner</option></select></label> : <span className={styles.role}>{member.role}</span>}
            {canManage && !member.isSelf && (member.status === "suspended" ? <button className={styles.secondary} type="button" disabled={busy} onClick={() => void act({ action: "restore", membershipId: member.id })}>Restore access</button> : confirmRemoval === member.id ? <div className={styles.confirm}><span>Remove access?</span><button type="button" className={styles.danger} disabled={busy} onClick={() => void act({ action: "revoke", membershipId: member.id })}>Remove</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmRemoval("")}>Cancel</button></div> : <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmRemoval(member.id)}>Remove access</button>)}
          </div>
        </article>)}
      </section>
      <div className={styles.roles}><div><strong>Viewer</strong><p>Explore maps, reports and program results.</p></div><div><strong>Editor</strong><p>Also manage campaigns, sessions and council profile settings.</p></div><div><strong>Owner</strong><p>Also invite people and manage team access. Another owner must change your own access.</p></div></div>
    </>}
  </div>;
}
