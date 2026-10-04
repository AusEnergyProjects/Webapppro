"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import NextImage from "next/image";
import type { CouncilProfile, CouncilProfileInput } from "@/lib/council-profile";
import { COUNCIL_THEME_PRESETS } from "@/lib/council-theme";
import { CouncilIcon } from "./CouncilPrimitives";
import shared from "./CouncilWorkspace.module.css";
import styles from "./CouncilProfileSettings.module.css";

async function prepareLogo(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!png && !jpeg && !webp) throw new Error("Choose a PNG, JPEG or WebP image. SVG files are not supported.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error("This image could not be read. Try another PNG, JPEG or WebP file."); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error("Choose a logo image with no more than 32 million pixels.");
    const ratio = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const logo = canvas.toDataURL("image/png");
    const decodedBytes = Math.ceil((logo.split(",")[1]?.length ?? 0) * 3 / 4);
    if (decodedBytes > 256 * 1024) throw new Error("The resized logo is too large. Choose a simpler image.");
    return logo;
  } finally { URL.revokeObjectURL(url); }
}

function demonstrationLogo(name: string, colour: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare a sample logo.");
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, 256, 256);
  context.fillStyle = colour; context.beginPath(); context.arc(128, 128, 105, 0, Math.PI * 2); context.fill();
  context.strokeStyle = "#ffffff"; context.lineWidth = 6; context.beginPath(); context.moveTo(70, 107); context.lineTo(128, 71); context.lineTo(186, 107); context.stroke();
  context.fillStyle = "#ffffff"; context.fillRect(89, 115, 7, 26); context.fillRect(124, 115, 7, 26); context.fillRect(159, 115, 7, 26);
  context.font = "bold 34px Arial"; context.textAlign = "center"; context.fillText(name.split(" ").filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "GC", 128, 186);
  return canvas.toDataURL("image/png");
}

type Props = {
  profile: CouncilProfile;
  value: CouncilProfileInput;
  canManage: boolean;
  dirty: boolean;
  demonstration: boolean;
  onChange: (value: CouncilProfileInput) => void;
  onSave: (value: CouncilProfileInput) => Promise<void>;
  onCancel: () => void;
  onResetDemo?: () => void;
};

export function CouncilProfileSettings({ profile, value, canManage, dirty, demonstration, onChange, onSave, onCancel, onResetDemo }: Props) {
  const [postcodeText, setPostcodeText] = useState("");
  const [saving, setSaving] = useState(false);
  const [preparingLogo, setPreparingLogo] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const postcodeId = useId();
  const disabled = !canManage || saving || preparingLogo;
  function update(next: CouncilProfileInput) { setNotice(""); setError(""); onChange(next); }
  function useSampleLogo() {
    try { update({ ...value, logoDataUrl: demonstrationLogo(value.name, value.theme.primaryColor) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The sample logo could not be prepared."); }
  }
  function withPendingPostcodes() {
    const additions = postcodeText.split(/[\s,;]+/).filter(Boolean);
    if (additions.some(postcode => !/^\d{4}$/.test(postcode))) throw new Error("Use four-digit postcodes, separated by commas or spaces.");
    const postcodes = [...new Set([...value.postcodes, ...additions])].sort();
    if (postcodes.length > 100) throw new Error("A council profile can include up to 100 postcodes.");
    return { ...value, postcodes };
  }
  function addPostcodes() {
    try { update(withPendingPostcodes()); setPostcodeText(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check the postcodes and try again."); }
  }
  async function uploadLogo(file: File) {
    setError(""); setNotice(""); setPreparingLogo(true);
    try { onChange({ ...value, logoDataUrl: await prepareLogo(file) }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Your logo could not be prepared."); }
    finally { setPreparingLogo(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    let next: CouncilProfileInput;
    try {
      next = { ...withPendingPostcodes(), name: value.name.trim() };
      if (next.name.length < 2 || next.name.length > 120) throw new Error("Council name must be between 2 and 120 characters.");
      if (!next.postcodes.length) throw new Error("Add at least one postcode for your council.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Check your profile details."); return; }
    setSaving(true);
    try { await onSave(next); setPostcodeText(""); setNotice(demonstration ? "Profile updated. Your demonstration is ready to explore." : "Council profile saved. Your reporting area and branding are up to date."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Your council profile could not be saved."); }
    finally { setSaving(false); }
  }
  return <form className={styles.layout} onSubmit={event => void submit(event)}>
    <div className={styles.editor}>
      {!canManage && <p className={shared.notice}>You have reporting access. A council manager can update this profile.</p>}
      {error && <p className={shared.error} role="alert">{error}</p>}
      {notice && <p className={shared.notice} role="status">{notice}</p>}
      <fieldset className={styles.section} disabled={disabled}>
        <legend>Council identity</legend><p className={styles.intro}>Make this workspace recognisably yours. Your name and logo stay visible across every view.</p>
        <div className={styles.logoEditor}><div className={styles.logoBox}>{value.logoDataUrl ? <NextImage unoptimized src={value.logoDataUrl} alt={`${value.name || "Council"} logo preview`} width={72} height={72} /> : <CouncilIcon name="business" size={32} />}</div><div><button type="button" className={shared.secondaryButton} onClick={() => fileInput.current?.click()}>{preparingLogo ? "Preparing logo..." : value.logoDataUrl ? "Change logo" : "Upload council logo"}</button>{value.logoDataUrl && <button type="button" className={shared.textButton} onClick={() => update({ ...value, logoDataUrl: null })}>Remove logo</button>}{demonstration && <button type="button" className={shared.textButton} onClick={useSampleLogo}>Try a sample logo</button>}<p className={styles.hint}>PNG, JPEG or WebP. Resized to 256 pixels and saved with your profile.</p><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Council logo file" className={styles.fileInput} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLogo(file); }} /></div></div>
        <label className={styles.field}>Council name<input required minLength={2} maxLength={120} value={value.name} autoComplete="organization" onChange={event => update({ ...value, name: event.target.value })} /></label>
        <div className={styles.state}><span>State or territory</span><strong>{profile.state}</strong></div>
      </fieldset>
      <fieldset className={styles.section} disabled={disabled}>
        <legend>Your reporting postcodes</legend><p className={styles.intro}>Choose the postcodes that belong in your council workspace. Saving updates your reporting area.</p>
        <div className={styles.postcodeChips} aria-label="Selected reporting postcodes">{value.postcodes.map(postcode => <span key={postcode}>{postcode}<button type="button" aria-label={`Remove postcode ${postcode}`} onClick={() => update({ ...value, postcodes: value.postcodes.filter(item => item !== postcode) })}>×</button></span>)}{!value.postcodes.length && <p className={styles.hint}>Add a postcode below to start your area.</p>}</div>
        <label className={styles.field} htmlFor={postcodeId}>Add postcodes</label><div className={styles.postcodeEntry}><input id={postcodeId} value={postcodeText} onChange={event => { setPostcodeText(event.target.value); setError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addPostcodes(); } }} placeholder="For example: 3805, 3806" maxLength={600} /><button type="button" className={shared.secondaryButton} onClick={addPostcodes} disabled={disabled || !postcodeText.trim()}><CouncilIcon name="plus" size={16} />Add</button></div><p className={styles.hint}>Up to 100 postcodes in {profile.state}. Postcodes can cross council boundaries, so these totals describe the postcode area.</p>
      </fieldset>
      <fieldset className={styles.section} disabled={disabled}>
        <legend>Your workspace colours</legend><p className={styles.intro}>Try a theme or choose your council colours. The whole workspace previews your changes as you go.</p>
        <div className={styles.presets} role="group" aria-label="Council theme presets">{COUNCIL_THEME_PRESETS.map(preset => <button type="button" key={preset.name} aria-pressed={value.theme.primaryColor.toLowerCase() === preset.primaryColor && value.theme.accentColor.toLowerCase() === preset.accentColor} onClick={() => update({ ...value, theme: { primaryColor: preset.primaryColor, accentColor: preset.accentColor } })}><span className={styles.swatch} style={{ background: `linear-gradient(135deg,${preset.primaryColor} 50%,${preset.accentColor} 50%)` }} />{preset.name}</button>)}</div>
        <div className={styles.colours}><label>Primary colour<div><input type="color" aria-label="Primary colour" value={value.theme.primaryColor} onChange={event => update({ ...value, theme: { ...value.theme, primaryColor: event.target.value } })} /><input key={value.theme.primaryColor} className={styles.hexInput} type="text" aria-label="Primary colour hex" defaultValue={value.theme.primaryColor.toUpperCase()} pattern="#[0-9a-fA-F]{6}" maxLength={7} spellCheck={false} onChange={event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) update({ ...value, theme: { ...value.theme, primaryColor: event.target.value.toLowerCase() } }); }} onBlur={event => { if (!/^#[0-9a-f]{6}$/i.test(event.target.value)) setError("Enter a six-digit hex colour, such as #032733."); }} /></div></label><label>Accent colour<div><input type="color" aria-label="Accent colour" value={value.theme.accentColor} onChange={event => update({ ...value, theme: { ...value.theme, accentColor: event.target.value } })} /><input key={value.theme.accentColor} className={styles.hexInput} type="text" aria-label="Accent colour hex" defaultValue={value.theme.accentColor.toUpperCase()} pattern="#[0-9a-fA-F]{6}" maxLength={7} spellCheck={false} onChange={event => { if (/^#[0-9a-f]{6}$/i.test(event.target.value)) update({ ...value, theme: { ...value.theme, accentColor: event.target.value.toLowerCase() } }); }} onBlur={event => { if (!/^#[0-9a-f]{6}$/i.test(event.target.value)) setError("Enter a six-digit hex colour, such as #032733."); }} /></div></label></div><p className={styles.hint}>Text and button shades adjust automatically for readable day and night modes.</p>
      </fieldset>
      <div className={styles.saveBar}><span>{dirty || postcodeText ? "Previewing unsaved changes" : "Your saved council profile"}</span><div><button type="button" className={shared.secondaryButton} disabled={disabled || (!dirty && !postcodeText)} onClick={() => { onCancel(); setPostcodeText(""); setError(""); setNotice(""); }}>Cancel changes</button><button type="submit" className={shared.primaryButton} disabled={disabled || (!dirty && !postcodeText)}><CouncilIcon name="check" size={16} />{saving ? "Saving profile..." : "Save council profile"}</button></div></div>
    </div>
    <aside className={styles.previewColumn}>
      <section className={styles.preview}><div className={styles.previewHeader}><span className={styles.previewLogo}>{value.logoDataUrl ? <NextImage unoptimized src={value.logoDataUrl} alt="" width={52} height={52} /> : <CouncilIcon name="business" size={25} />}</span><div><small>Your council workspace</small><h2>{value.name || "Your council"}</h2></div></div><div className={styles.previewBody}><span className={shared.eyebrow}>Live preview</span><h3>Local action.<br />Your identity.</h3><p>Your community insights, with a familiar council presence.</p><div className={styles.previewScope}><strong>{value.postcodes.length}</strong><span>reporting postcodes<br />{profile.state}</span></div><div className={styles.previewBars} aria-hidden="true"><span /><span /><span /><span /><span /></div><span className={styles.previewTag}>TLink Council workspace</span></div></section>
      <div className={styles.previewNote}><CouncilIcon name="shield" size={20} /><p>Your visual identity changes. Customer information remains protected in every view.</p></div>
      {demonstration && onResetDemo && <section className={styles.reset}><h3>Start a fresh demonstration</h3><p>Reset the profile, practice campaigns and sessions saved in this browser.</p>{confirmReset ? <><p className={styles.resetQuestion}>Discard your local practice changes?</p><div><button type="button" className={shared.secondaryButton} onClick={() => setConfirmReset(false)}>Keep changes</button><button type="button" className={shared.secondaryButton} onClick={() => { onCancel(); onResetDemo(); setConfirmReset(false); setPostcodeText(""); setNotice(""); }}>Reset demonstration</button></div></> : <button type="button" className={shared.textButton} onClick={() => setConfirmReset(true)}><CouncilIcon name="refresh" size={15} />Reset demonstration</button>}</section>}
    </aside>
  </form>;
}
