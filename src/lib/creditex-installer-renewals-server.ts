import { tradeTeamDocumentExpiryStatus } from "./trade-team-document-expiry-server";

export type CreditexInstallerRenewal = {
  type: "licence" | "insurance" | "qualification";
  title: string;
  expiresAt: string;
  status: ReturnType<typeof tradeTeamDocumentExpiryStatus>;
};

type RenewalRow = {
  participant_id: string;
  category: CreditexInstallerRenewal["type"];
  title: string;
  file_expiry: string;
  credential_expiry: string | null;
};

export async function loadCreditexInstallerRenewals(
  database: D1Database,
  input: {
    organisationId: string;
    role: string;
    participantIds: readonly string[];
    now?: Date;
  },
): Promise<Record<string, CreditexInstallerRenewal[]>> {
  if (input.role !== "admin" || !input.organisationId || !input.participantIds.length) return {};
  const participantIds = [...new Set(input.participantIds)];
  if (participantIds.length > 50 || participantIds.some((id) => !id || id.length > 180)) {
    throw new Error("CREDITEX_RENEWAL_PARTICIPANTS_INVALID");
  }
  const now = input.now ?? new Date();
  // Resolve against every candidate before limiting the returned participant list.
  // Otherwise a second, unrequested participant could hide an ambiguous identity.
  const result = await database.prepare(`WITH linked_jobs AS (
      SELECT DISTINCT account.firebase_uid owner_uid, account.verified_abn,
        work.id work_order_id, work.assignee_member_id
      FROM compliance_organisations organisation
      JOIN trade_work_order_compliance_intents intent
        ON intent.compliance_organisation_id = organisation.id
        AND intent.status IN ('planned', 'case_linked')
      JOIN trade_work_orders work
        ON work.id = intent.work_order_id AND work.firebase_uid = intent.installer_uid
        AND work.partner_type = 'installer' AND work.record_status = 'active'
        AND work.stage NOT IN ('completed', 'cancelled')
      JOIN trade_accounts account
        ON account.firebase_uid = intent.installer_uid
        AND account.partner_type = 'installer' AND account.account_status = 'active'
      WHERE organisation.id = ? AND organisation.organisation_code = 'CREDITEX-AU'
        AND organisation.status = 'active'
    ), linked_owners AS (
      SELECT DISTINCT owner_uid, verified_abn FROM linked_jobs
    ), participant_candidates AS (
      SELECT participant.id participant_id, owner.owner_uid,
        CASE WHEN participant.external_reference = owner.owner_uid THEN 1 ELSE 0 END exact_owner
      FROM linked_owners owner
      JOIN compliance_participants participant
        ON participant.organisation_id = ? AND participant.participant_type = 'installer'
        AND participant.status = 'active'
        AND (participant.external_reference = owner.owner_uid
          OR (owner.verified_abn <> '' AND participant.abn = owner.verified_abn))
    ), preferred_candidates AS (
      SELECT candidate.* FROM participant_candidates candidate
      WHERE candidate.exact_owner = 1 OR NOT EXISTS (
        SELECT 1 FROM participant_candidates exact
        WHERE exact.owner_uid = candidate.owner_uid AND exact.exact_owner = 1
      )
    ), unique_candidates AS (
      SELECT participant_id, owner_uid,
        COUNT(*) OVER (PARTITION BY owner_uid) participant_count,
        COUNT(*) OVER (PARTITION BY participant_id) owner_count
      FROM preferred_candidates
    )
    SELECT candidate.participant_id,
      CASE WHEN file.category IN ('licence', 'insurance') THEN file.category ELSE 'qualification' END category,
      file.title, file.expires_at file_expiry,
      (SELECT MIN(credential.expires_at) FROM trade_team_member_credentials credential
        WHERE credential.file_id = file.id AND credential.owner_uid = file.owner_uid
          AND credential.team_member_id = file.team_member_id AND credential.status = 'active'
          AND credential.expires_at <> ''
          AND date(credential.expires_at, '+0 days') = credential.expires_at) credential_expiry
    FROM unique_candidates candidate
    JOIN trade_team_members member
      ON member.owner_uid = candidate.owner_uid AND member.status = 'active'
      AND (member.member_uid = candidate.owner_uid OR EXISTS (
        SELECT 1 FROM linked_jobs job WHERE job.owner_uid = candidate.owner_uid
          AND job.assignee_member_id = member.id
      ))
    JOIN trade_team_member_files file
      ON file.owner_uid = candidate.owner_uid AND file.team_member_id = member.id
      AND file.status = 'active'
      AND (file.category IN ('licence', 'insurance') OR (
        file.category IN ('training', 'compliance', 'other') AND EXISTS (
          SELECT 1 FROM trade_team_member_credentials qualification
          WHERE qualification.file_id = file.id AND qualification.owner_uid = file.owner_uid
            AND qualification.team_member_id = file.team_member_id AND qualification.status = 'active'
            AND qualification.credential_type IN ('training', 'accreditation')
        )
      ))
    WHERE candidate.participant_count = 1 AND candidate.owner_count = 1
      AND candidate.participant_id IN (${participantIds.map(() => "?").join(", ")})
    ORDER BY candidate.participant_id, file.category, file.title, file.id`)
    .bind(input.organisationId, input.organisationId, ...participantIds)
    .all<RenewalRow>();

  const renewals = new Map<string, CreditexInstallerRenewal[]>();
  for (const row of result.results) {
    const expiresAt = [row.file_expiry, row.credential_expiry || ""]
      .filter((date) => tradeTeamDocumentExpiryStatus(date, now) !== "no_expiry")
      .sort()[0] || "";
    const items = renewals.get(row.participant_id) ?? [];
    items.push({
      type: row.category,
      title: row.title.trim() || ({ insurance: "Insurance", licence: "Licence", qualification: "Qualification" })[row.category],
      expiresAt,
      status: tradeTeamDocumentExpiryStatus(expiresAt, now),
    });
    renewals.set(row.participant_id, items);
  }
  return Object.fromEntries(renewals);
}
