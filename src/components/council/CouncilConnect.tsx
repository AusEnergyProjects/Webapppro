"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CouncilApi } from "@/components/CouncilPortal";
import { mergeCouncilConnectMessages, parseCouncilConnectAction, type CouncilConnectConversation, type CouncilConnectDirectory, type CouncilConnectMessage } from "@/lib/council-connect";
import { councilDateTime } from "./CouncilPrimitives";
import styles from "./CouncilConnect.module.css";

const demoMember = "demo-owner";
const demoPeer = "demo-editor";
const sampleMessage: CouncilConnectMessage = { id: "f0c0809f-bc59-4fc8-900c-13c19939420e", senderId: demoPeer, senderName: "Community programs", body: "Could we compare upgrade activity across our postcodes before planning the next information session?", createdAt: "2026-10-07T00:00:00.000Z" };
const sampleDirectory: CouncilConnectDirectory = { memberId: demoMember, hasMore: false, unread: 1, people: [{ id: demoPeer, name: "Community programs", role: "editor", unread: 1, lastMessage: sampleMessage.body, lastMessageAt: sampleMessage.createdAt }] };

export function CouncilConnect({ councilId, api, demonstration = false }: { councilId: string; api?: CouncilApi; demonstration?: boolean }) {
  const [directory, setDirectory] = useState<CouncilConnectDirectory | null>(() => demonstration ? sampleDirectory : null);
  const [peerId, setPeerId] = useState("");
  const [conversation, setConversation] = useState<CouncilConnectConversation | null>(null);
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!demonstration);
  const [sendingTo, setSendingTo] = useState<string[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [receiptRefresh, setReceiptRefresh] = useState(0);
  const acknowledged = useRef(new Map<string, string>());
  const lifetime = useRef(0);
  const sampleMessages = useRef([sampleMessage]);
  const attemptedSends = useRef(new Map<string, { id: string; peerId: string; body: string }>());
  const olderRequest = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const page = `/api/council/connect?councilId=${encodeURIComponent(councilId)}`;
  const peer = directory?.people.find(person => person.id === peerId);
  const draft = drafts[peerId] ?? "";
  const sending = sendingTo.includes(peerId);

  useEffect(() => {
    const current = ++lifetime.current;
    const controller = new AbortController();
    let active = false;
    const visible = () => document.visibilityState !== "hidden" && !panel.current?.closest("[hidden]");
    async function sync() {
      if (active || !visible()) return;
      active = true;
      try {
        if (demonstration) {
          const sample = sampleMessages.current;
          setDirectory(previous => ({ ...sampleDirectory, unread: peerId ? 0 : previous?.unread ?? 1,
            people: sampleDirectory.people.filter(person => person.name.toLowerCase().includes(search.toLowerCase())).map(person => ({ ...person, unread: peerId ? 0 : previous?.unread ?? 1, lastMessage: sample.at(-1)?.body ?? "", lastMessageAt: sample.at(-1)?.createdAt ?? "" })) }));
          setConversation(peerId ? { memberId: demoMember, peerId, messages: sample, before: "", hasMore: false } : null);
        } else {
          if (!api) throw new Error("The council connection is unavailable. Reload the workspace.");
          const roster = await api<{ directory: CouncilConnectDirectory }>(`${page}&search=${encodeURIComponent(search)}`, { signal: controller.signal });
          if (current !== lifetime.current) return;
          setDirectory(roster.directory);
          if (peerId) {
            const result = await api<{ conversation: CouncilConnectConversation }>(`${page}&peerId=${encodeURIComponent(peerId)}`, { signal: controller.signal });
            if (current !== lifetime.current) return;
            setConversation(previous => {
              // A resumed tab may have missed more than one page. Start from the
              // new contiguous window so its cursor can reach every missed message.
              if (previous?.peerId !== peerId || !result.conversation.messages.some(message => previous.messages.some(saved => saved.id === message.id))) return result.conversation;
              return { ...result.conversation, before: previous.before || result.conversation.before, hasMore: previous.hasMore, messages: mergeCouncilConnectMessages(previous.messages, result.conversation.messages) };
            });
          } else setConversation(null);
        }
        if (current === lifetime.current) { setError(""); setLoading(false); setReceiptRefresh(value => value + 1); }
      } catch (failure) {
        if (current !== lifetime.current || controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : "Messages could not be loaded. Try again.");
        setDirectory(null); setConversation(null); setLoading(false);
      } finally { active = false; }
    }
    const timer = window.setTimeout(() => { if (current === lifetime.current) { setLoading(true); setLoadingOlder(false); void sync(); } }, search ? 250 : 0);
    const interval = window.setInterval(() => { void sync(); }, 10000);
    const focus = () => { void sync(); };
    window.addEventListener("focus", focus); window.addEventListener("popstate", focus); document.addEventListener("visibilitychange", focus);
    return () => { lifetime.current = current + 1; controller.abort(); olderRequest.current?.abort(); window.clearTimeout(timer); window.clearInterval(interval); window.removeEventListener("focus", focus); window.removeEventListener("popstate", focus); document.removeEventListener("visibilitychange", focus); };
  }, [api, councilId, demonstration, page, peerId, refresh, search]);

  const latestIncoming = conversation?.messages.findLast(message => message.senderId !== conversation.memberId)?.id;
  useEffect(() => {
    if (!latestIncoming || !peerId || !api || demonstration || document.visibilityState === "hidden" || panel.current?.closest("[hidden]") || acknowledged.current.get(peerId) === latestIncoming) return;
    const controller = new AbortController(); const current = lifetime.current;
    void api(page, { method: "POST", body: JSON.stringify({ action: "read", peerId, messageId: latestIncoming }), signal: controller.signal })
      .then(() => { if (current !== lifetime.current) return; acknowledged.current.set(peerId, latestIncoming); setDirectory(previous => previous ? { ...previous, unread: Math.max(0, previous.unread - (previous.people.find(person => person.id === peerId)?.unread ?? 0)), people: previous.people.map(person => person.id === peerId ? { ...person, unread: 0 } : person) } : previous); })
      .catch(() => { /* The next refresh retains the unread count if the receipt was not saved. */ });
    return () => controller.abort();
  }, [api, demonstration, latestIncoming, page, peerId, receiptRefresh]);

  const latestMessage = conversation?.messages.at(-1)?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [latestMessage]);

  function choosePeer(id: string) {
    setPeerId(id); setConversation(null); setError(""); setSendError(""); setNotice(""); setLoadingOlder(false); setLoading(Boolean(id));
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !peerId || !draft.trim() || !conversation) return;
    const currentPeer = peerId; const body = draft.trim(); const current = lifetime.current;
    const previous = attemptedSends.current.get(currentPeer);
    const attempt = previous?.body === body ? previous : { id: crypto.randomUUID(), peerId: currentPeer, body };
    attemptedSends.current.set(currentPeer, attempt);
    setSendingTo(peers => [...peers, currentPeer]); setSendError(""); setNotice("");
    try {
      const action = parseCouncilConnectAction({ action: "send", id: attempt.id, recipientId: currentPeer, body });
      if (demonstration) {
        sampleMessages.current = [...sampleMessages.current, { id: attempt.id, senderId: demoMember, senderName: "You", body, createdAt: new Date().toISOString() }];
      } else {
        if (!api) throw new Error("The council connection is unavailable. Reload the workspace.");
        await api(page, { method: "POST", body: JSON.stringify(action) });
      }
      if (attemptedSends.current.get(currentPeer)?.id === attempt.id) attemptedSends.current.delete(currentPeer);
      setDrafts(previousDrafts => previousDrafts[currentPeer]?.trim() === body ? { ...previousDrafts, [currentPeer]: "" } : previousDrafts);
      if (current !== lifetime.current) return;
      setNotice(demonstration ? "Practice message added. Nothing was sent to anyone." : "Message sent.");
      setRefresh(value => value + 1);
    } catch (failure) {
      if (current === lifetime.current) setSendError(`${failure instanceof Error ? failure.message : "We could not confirm the send."} Your draft is kept. Retrying the same message will not send it twice.`);
    } finally { setSendingTo(peers => peers.filter(id => id !== currentPeer)); }
  }
  async function older() {
    if (!api || !conversation?.hasMore || loadingOlder) return;
    const current = lifetime.current; const controller = new AbortController(); olderRequest.current = controller; setLoadingOlder(true); setError("");
    try {
      const result = await api<{ conversation: CouncilConnectConversation }>(`${page}&peerId=${encodeURIComponent(peerId)}&before=${encodeURIComponent(conversation.before)}`, { signal: controller.signal });
      if (current === lifetime.current) setConversation(previous => previous ? { ...result.conversation, messages: mergeCouncilConnectMessages(result.conversation.messages, previous.messages) } : result.conversation);
    } catch (failure) { if (current === lifetime.current) setError(failure instanceof Error ? failure.message : "Earlier messages could not be loaded."); }
    finally { if (olderRequest.current === controller) olderRequest.current = null; if (current === lifetime.current) setLoadingOlder(false); }
  }

  return <section ref={panel} className={styles.connect} aria-label="Council team messages">
    {demonstration && <p className={styles.notice}>Sample conversation. Practice messages stay in this demonstration and are never delivered.</p>}
    {error && <div className={styles.error} role="alert">{error} <button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    <div className={styles.layout} data-conversation-open={Boolean(peerId)}>
      <aside className={styles.people} aria-label="Council colleagues">
        <header><h2>Your team</h2><span>{directory?.unread ? `${directory.unread} unread` : "Council colleagues"}</span></header>
        <label className={styles.search}><span>Find a colleague</span><input type="search" value={search} maxLength={100} placeholder="Search by name" onChange={event => setSearch(event.target.value)} /></label>
        {loading && !directory && <p className={styles.empty} role="status">Loading your team...</p>}
        {directory?.people.map(person => <button type="button" className={styles.person} aria-current={peerId === person.id ? "true" : undefined} key={person.id} onClick={() => choosePeer(person.id)}><span className={styles.avatar} aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span><span className={styles.personCopy}><strong>{person.name}</strong><span>{person.lastMessage || "Start a conversation"}</span><small>{person.role}</small></span>{person.unread > 0 && <span className={styles.badge} aria-label={`${person.unread} unread messages`}>{person.unread > 99 ? "99+" : person.unread}</span>}</button>)}
        {directory && !directory.people.length && <p className={styles.empty}>{search ? "No colleagues match that name." : "Colleagues appear here after accepting their council invitation. Invite them from Council team."}</p>}
        {directory?.hasMore && <p className={styles.empty}>Showing the first 100 colleagues. Search for a name to find someone else.</p>}
      </aside>
      <div className={styles.conversation}>
        {peerId ? <>
          <header className={styles.conversationHeading}><button type="button" className={styles.back} onClick={() => choosePeer("")}>Back to team</button><div><h2>{peer?.name ?? "Team conversation"}</h2><p>Private conversation in your council</p></div><button type="button" className={styles.refresh} onClick={() => setRefresh(value => value + 1)} aria-label="Refresh messages">Refresh</button></header>
          <div className={styles.messages} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions text">
            {conversation?.hasMore && <button type="button" className={styles.older} disabled={loadingOlder} onClick={() => { void older(); }}>{loadingOlder ? "Loading..." : "Load earlier messages"}</button>}
            {loading && !conversation && <p className={styles.empty} role="status">Loading conversation...</p>}
            {conversation && !conversation.messages.length && <p className={styles.empty}>Start the conversation with {peer?.name ?? "your colleague"}.</p>}
            {conversation?.messages.map(message => <article key={message.id} className={`${styles.message} ${message.senderId === conversation.memberId ? styles.own : ""}`}><strong>{message.senderId === conversation.memberId ? "You" : message.senderName}</strong><p>{message.body}</p><time dateTime={message.createdAt}>{councilDateTime(message.createdAt, "Australia/Sydney")}</time></article>)}
            <div ref={end} />
          </div>
          <form className={styles.compose} onSubmit={event => { void send(event); }}>
            {sendError && <p className={styles.error} role="alert">{sendError}</p>}
            {notice && <p className={styles.sent} role="status">{notice}</p>}
            <label htmlFor={`council-message-${councilId}`}>Message {peer?.name ?? "your colleague"}</label><textarea id={`council-message-${councilId}`} value={draft} maxLength={4000} rows={3} placeholder="Coordinate your next campaign, information session or report..." onChange={event => setDrafts(previous => ({ ...previous, [peerId]: event.target.value }))} />
            <div><small>{draft.length}/4000</small><button type="submit" disabled={sending || !conversation || !draft.trim()}>{sending ? "Sending..." : demonstration ? "Add practice message" : "Send message"}</button></div>
          </form>
        </> : <div className={styles.welcome}><span aria-hidden="true">↗</span><h2>A quick word with your team.</h2><p>Choose a colleague to coordinate programs, share an update or discuss your next information session.</p></div>}
      </div>
    </div>
  </section>;
}
