import { addressLocalitiesForPostcode } from "./address-localities.mjs";
import { CouncilProfileInputError, type CouncilProfile, type CouncilProfileInput } from "./council-profile";

type ProfileRow = {
  id: string; name: string; state: string; logo_data_url: string | null;
  primary_color: string; accent_color: string; updated_at: string; postcodes_json: string;
};

const readSql = `SELECT c.id,c.name,c.state,c.logo_data_url,c.primary_color,c.accent_color,c.updated_at,
  (SELECT json_group_array(postcode) FROM (SELECT p.postcode FROM council_postcodes p WHERE p.council_id=c.id AND p.state=c.state ORDER BY p.postcode)) postcodes_json
  FROM council_organisations c WHERE c.id=? AND c.status='active' AND EXISTS (
    SELECT 1 FROM council_memberships m WHERE m.council_id=c.id AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor','viewer'))`;
const editable = `c.id=? AND c.state=? AND c.status='active' AND EXISTS (
  SELECT 1 FROM council_memberships m WHERE m.council_id=c.id AND m.firebase_uid=? AND m.status='active' AND m.role IN ('owner','editor'))`;

function profile(row: ProfileRow): CouncilProfile {
  return { councilId: row.id, name: row.name, state: row.state, logoDataUrl: row.logo_data_url,
    theme: { primaryColor: row.primary_color, accentColor: row.accent_color },
    postcodes: JSON.parse(row.postcodes_json), updatedAt: row.updated_at };
}

export async function readCouncilProfile(db: D1Database, councilId: string, actorUid: string): Promise<CouncilProfile | null> {
  const row = await db.prepare(readSql).bind(councilId, actorUid).first<ProfileRow>();
  return row ? profile(row) : null;
}

export async function saveCouncilProfile(db: D1Database, councilId: string, actorUid: string, state: string, input: CouncilProfileInput): Promise<CouncilProfile | null> {
  for (const postcode of input.postcodes) {
    const options = addressLocalitiesForPostcode(postcode);
    if (!options?.localities.some((locality: { state: string }) => locality.state === state)) {
      throw new CouncilProfileInputError(`${postcode} is not a recognised residential postcode in ${state}.`);
    }
  }
  const now = new Date().toISOString();
  const guard = [councilId, state, actorUid];
  const postcodes = JSON.stringify(input.postcodes);
  const logoHash = input.logoDataUrl
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.logoDataUrl))), byte => byte.toString(16).padStart(2, "0")).join("")
    : null;
  const metadata = JSON.stringify({ name: input.name, postcodes: input.postcodes, theme: input.theme,
    logoPresent: input.logoDataUrl !== null, logoSha256: logoHash });
  // D1 batch is atomic. Each statement rechecks authority inside that transaction;
  // the audit uses the existing log and omits the image payload entirely.
  const result = await db.batch<ProfileRow>([
    db.prepare(`INSERT INTO admin_audit_log(id,admin_uid,action,entity_type,entity_id,summary,metadata,created_at)
      SELECT ?,?,'council.profile_updated','council',c.id,'Updated council profile, branding and reporting postcodes.',
        json_object('before',json_object('name',c.name,'postcodes',json((SELECT json_group_array(postcode) FROM council_postcodes WHERE council_id=c.id))), 'after',json(?)),?
      FROM council_organisations c WHERE ${editable}`).bind(crypto.randomUUID(), actorUid, metadata, now, ...guard),
    db.prepare(`UPDATE council_organisations AS c SET name=?,logo_data_url=?,primary_color=?,accent_color=?,updated_at=?
      WHERE ${editable}`).bind(input.name, input.logoDataUrl, input.theme.primaryColor, input.theme.accentColor, now, ...guard),
    db.prepare(`DELETE FROM council_postcodes WHERE council_id=? AND EXISTS (SELECT 1 FROM council_organisations c WHERE ${editable})`).bind(councilId, ...guard),
    db.prepare(`INSERT INTO council_postcodes(council_id,state,postcode,approved_by_uid,created_at)
      SELECT c.id,c.state,j.value,?,? FROM council_organisations c,json_each(?) j WHERE ${editable}`).bind(actorUid, now, postcodes, ...guard),
    db.prepare(readSql).bind(councilId, actorUid),
  ]);
  if (!result[1].meta.changes) return null;
  const rows = result[4].results;
  return rows[0] ? profile(rows[0]) : null;
}
