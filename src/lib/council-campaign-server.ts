import { campaignSharePath, councilReferenceCode, type CouncilCampaign } from "./council-campaigns.ts";

type CampaignRow = {
  id: string; council_id: string; code: string; title: string; kind: CouncilCampaign["kind"];
  audience: CouncilCampaign["audience"]; status: CouncilCampaign["status"];
  starts_at: string | null; location: string | null; meeting_url: string | null;
  opens: number; created_at: string; updated_at: string;
};

export function campaignFromRow(row: CampaignRow): CouncilCampaign {
  return { id: row.id, councilId: row.council_id, code: row.code, title: row.title, kind: row.kind, audience: row.audience,
    status: row.status, startsAt: row.starts_at, location: row.location, meetingUrl: row.meeting_url,
    opens: row.opens, createdAt: row.created_at, updatedAt: row.updated_at, shareUrl: campaignSharePath(row.code) };
}

export async function listCouncilCampaigns(db: Pick<D1Database, "prepare">, councilId: string): Promise<CouncilCampaign[]> {
  const rows = await db.prepare(`SELECT id,council_id,code,title,kind,audience,status,starts_at,location,meeting_url,opens,created_at,updated_at
    FROM council_campaigns WHERE council_id=? ORDER BY created_at DESC LIMIT 200`).bind(councilId).all<CampaignRow>();
  return rows.results.map(campaignFromRow);
}

export type CouncilReferral = { campaignId: string; councilId: string; code: string };

export async function resolveCouncilReferral(db: Pick<D1Database, "prepare">, value: unknown, postcode: string, state: string): Promise<CouncilReferral> {
  const code = councilReferenceCode(value);
  if (!code) throw new Error("COUNCIL_REFERENCE_INVALID");
  const row = await db.prepare(`SELECT c.id campaignId,c.council_id councilId,c.code
    FROM council_campaigns c JOIN council_organisations o ON o.id=c.council_id AND o.status='active'
    JOIN council_postcodes p ON p.council_id=c.council_id AND p.postcode=? AND p.state=?
    WHERE c.code=? AND c.status='active'`).bind(postcode,state,code).first<CouncilReferral>();
  if (!row) throw new Error("COUNCIL_REFERENCE_INVALID");
  return row;
}

export async function loadPublicCouncilCampaign(db: Pick<D1Database, "prepare">, value: unknown) {
  const code = councilReferenceCode(value);
  if (!code) return null;
  // Public projection is a deliberate allowlist. No membership, customer, job or analytics fields.
  return db.prepare(`SELECT c.code,c.title,c.kind,c.audience,c.starts_at startsAt,c.location,c.meeting_url meetingUrl,
    o.name councilName,o.state,o.logo_data_url logoDataUrl,
    o.primary_color primaryColor,o.accent_color accentColor,
    CASE WHEN o.public_journey_enabled=1 THEN o.public_home_url ELSE NULL END homeUrl,
    (SELECT json_group_array(p.postcode) FROM council_postcodes p WHERE p.council_id=o.id) postcodes
    FROM council_campaigns c JOIN council_organisations o ON o.id=c.council_id AND o.status='active'
    WHERE c.code=? AND c.status='active'`).bind(code).first<{
      code: string; title: string; kind: CouncilCampaign["kind"]; audience: CouncilCampaign["audience"];
      startsAt: string | null; location: string | null; meetingUrl: string | null;
      councilName: string; state: string; postcodes: string;
      logoDataUrl: string | null; primaryColor: string; accentColor: string; homeUrl: string | null;
    }>();
}
