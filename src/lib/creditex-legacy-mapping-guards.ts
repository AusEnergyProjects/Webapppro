import {
  canonicalCreditexSchemaGuardSql,
} from "./creditex-schema-guards.ts";

type LegacyMappingGuardDefinition = {
  readonly name: string;
  readonly sql: string;
};

const namedVerifiedMappingMember = (uidSql: string) => [
  "SELECT 1 FROM `compliance_users` member",
  "WHERE member.`organisation_id` = NEW.`organisation_id`",
  `AND member.\`firebase_uid\` = ${uidSql}`,
  "AND member.`role` IN ('admin', 'reviewer')",
  "AND member.`status` = 'active'",
  "AND member.`governance_identity_verified` = 1",
  "AND trim(member.`governance_identity_verified_by_uid`) <> ''",
  "AND member.`governance_identity_verified_by_uid` <> member.`firebase_uid`",
  "AND trim(member.`governance_identity_verified_at`) <> ''",
  "AND trim(member.`governance_identity_verification_basis`) <> ''",
  "AND trim(member.`display_name`) <> ''",
  "AND instr(member.`email`, '@') > 1",
  "AND lower(trim(member.`email`)) <> 'info@ausenergyassessments.com'",
].join(" ");

export const CREDITEX_LEGACY_MAPPING_GUARD_DEFINITIONS:
  readonly LegacyMappingGuardDefinition[] = Object.freeze([
    {
      name: "compliance_legacy_mapping_authoring_artifact_guard",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_authoring_artifact_guard\`
        BEFORE INSERT ON \`compliance_legacy_mapping_artifacts\`
        WHEN NEW.\`authorization_state\` = 'draft'
          AND NEW.\`object_key\` LIKE
            'd1:compliance_legacy_mapping_artifact_payloads:%'
        BEGIN
          SELECT CASE WHEN NOT EXISTS (
            ${namedVerifiedMappingMember("NEW.`requested_by_uid`")}
          ) THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_NAMED_AUTHOR_REQUIRED'
          ) END;
          SELECT CASE WHEN
            NEW.\`artifact_format\` <> 'json'
            OR NEW.\`object_key\` <>
              'd1:compliance_legacy_mapping_artifact_payloads:' || NEW.\`id\`
            OR NEW.\`authorization_basis\` <> ''
            OR NEW.\`primary_authorizer_uid\` <> ''
            OR NEW.\`secondary_authorizer_uid\` <> ''
            OR NEW.\`authorized_at\` <> ''
            OR NEW.\`withdrawn_by_uid\` <> ''
            OR NEW.\`withdrawn_at\` <> ''
          THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_DRAFT_INVALID'
          ) END;
        END;`,
    },
    {
      name: "compliance_legacy_mapping_authoring_artifact_immutable",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_authoring_artifact_immutable\`
        BEFORE UPDATE ON \`compliance_legacy_mapping_artifacts\`
        WHEN OLD.\`object_key\` LIKE
          'd1:compliance_legacy_mapping_artifact_payloads:%'
        BEGIN
          SELECT RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_ARTIFACT_IMMUTABLE'
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_authoring_artifact_no_delete",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_authoring_artifact_no_delete\`
        BEFORE DELETE ON \`compliance_legacy_mapping_artifacts\`
        WHEN OLD.\`object_key\` LIKE
          'd1:compliance_legacy_mapping_artifact_payloads:%'
        BEGIN
          SELECT RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_ARTIFACT_DELETE_FORBIDDEN'
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_payload_parent_guard",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_payload_parent_guard\`
        BEFORE INSERT ON \`compliance_legacy_mapping_artifact_payloads\`
        BEGIN
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1
            FROM \`compliance_legacy_mapping_artifacts\` artifact
            WHERE artifact.\`id\` = NEW.\`artifact_id\`
              AND artifact.\`organisation_id\` = NEW.\`organisation_id\`
              AND artifact.\`legacy_system_key\` = NEW.\`legacy_system_key\`
              AND artifact.\`mapping_version\` = NEW.\`mapping_version\`
              AND artifact.\`artifact_format\` = 'json'
              AND artifact.\`object_key\` =
                'd1:compliance_legacy_mapping_artifact_payloads:'
                  || NEW.\`artifact_id\`
              AND artifact.\`artifact_sha256\` = NEW.\`artifact_sha256\`
              AND artifact.\`authorization_state\` = 'draft'
              AND artifact.\`requested_by_uid\` = NEW.\`created_by_uid\`
              AND artifact.\`created_at\` = NEW.\`created_at\`
          ) THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_PAYLOAD_PARENT_INVALID'
          ) END;
          SELECT CASE WHEN NOT EXISTS (
            ${namedVerifiedMappingMember("NEW.`created_by_uid`")}
          ) THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_NAMED_AUTHOR_REQUIRED'
          ) END;
        END;`,
    },
    {
      name: "compliance_legacy_mapping_payload_immutable",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_payload_immutable\`
        BEFORE UPDATE ON \`compliance_legacy_mapping_artifact_payloads\`
        BEGIN
          SELECT RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_PAYLOAD_IMMUTABLE'
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_payload_no_delete",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_payload_no_delete\`
        BEFORE DELETE ON \`compliance_legacy_mapping_artifact_payloads\`
        BEGIN
          SELECT RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_PAYLOAD_DELETE_FORBIDDEN'
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_review_parent_guard",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_review_parent_guard\`
        BEFORE INSERT ON \`compliance_legacy_mapping_review_decisions\`
        BEGIN
          SELECT CASE WHEN NOT EXISTS (
            ${namedVerifiedMappingMember("NEW.`reviewed_by_uid`")}
          ) THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_NAMED_REVIEWER_REQUIRED'
          ) END;
          SELECT CASE WHEN
            length(NEW.\`reviewed_at\`) <> 24
            OR COALESCE(
              strftime('%Y-%m-%dT%H:%M:%fZ', NEW.\`reviewed_at\`),
              ''
            ) <> NEW.\`reviewed_at\`
          THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_REVIEW_TIME_INVALID'
          ) END;
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1
            FROM \`compliance_legacy_mapping_artifacts\` artifact
            JOIN \`compliance_legacy_mapping_artifact_payloads\` payload
              ON payload.\`artifact_id\` = artifact.\`id\`
              AND payload.\`organisation_id\` = artifact.\`organisation_id\`
              AND payload.\`legacy_system_key\` =
                artifact.\`legacy_system_key\`
              AND payload.\`mapping_version\` = artifact.\`mapping_version\`
              AND payload.\`artifact_sha256\` = artifact.\`artifact_sha256\`
            WHERE artifact.\`id\` = NEW.\`artifact_id\`
              AND artifact.\`organisation_id\` = NEW.\`organisation_id\`
              AND artifact.\`legacy_system_key\` =
                NEW.\`legacy_system_key\`
              AND artifact.\`mapping_version\` = NEW.\`mapping_version\`
              AND artifact.\`artifact_sha256\` = NEW.\`artifact_sha256\`
              AND artifact.\`artifact_format\` = 'json'
              AND artifact.\`authorization_state\` = 'draft'
              AND artifact.\`requested_by_uid\` <> NEW.\`reviewed_by_uid\`
              AND payload.\`created_by_uid\` <> NEW.\`reviewed_by_uid\`
          ) THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_REVIEW_PARENT_INVALID'
          ) END;
          SELECT CASE WHEN NOT (
            (
              NEW.\`decision\` IN ('approved', 'rejected')
              AND NEW.\`supersedes_decision_id\` = ''
              AND NOT EXISTS (
                SELECT 1
                FROM \`compliance_legacy_mapping_review_decisions\` existing
                WHERE existing.\`organisation_id\` =
                  NEW.\`organisation_id\`
                  AND existing.\`artifact_id\` = NEW.\`artifact_id\`
              )
            )
            OR
            (
              NEW.\`decision\` = 'withdrawn'
              AND EXISTS (
                SELECT 1
                FROM \`compliance_legacy_mapping_review_decisions\` prior
                WHERE prior.\`id\` = NEW.\`supersedes_decision_id\`
                  AND prior.\`organisation_id\` = NEW.\`organisation_id\`
                  AND prior.\`artifact_id\` = NEW.\`artifact_id\`
                  AND prior.\`legacy_system_key\` =
                    NEW.\`legacy_system_key\`
                  AND prior.\`mapping_version\` = NEW.\`mapping_version\`
                  AND prior.\`artifact_sha256\` = NEW.\`artifact_sha256\`
                  AND prior.\`decision\` = 'approved'
                  AND NEW.\`reviewed_at\` > prior.\`reviewed_at\`
                  AND NOT EXISTS (
                    SELECT 1
                    FROM \`compliance_legacy_mapping_review_decisions\` newer
                    WHERE newer.\`organisation_id\` =
                      prior.\`organisation_id\`
                      AND newer.\`artifact_id\` = prior.\`artifact_id\`
                      AND (
                        newer.\`reviewed_at\` > prior.\`reviewed_at\`
                        OR (
                          newer.\`reviewed_at\` = prior.\`reviewed_at\`
                          AND newer.\`id\` > prior.\`id\`
                        )
                      )
                  )
              )
            )
          ) THEN RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_REVIEW_TRANSITION_INVALID'
          ) END;
        END;`,
    },
    {
      name: "compliance_legacy_mapping_review_immutable",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_review_immutable\`
        BEFORE UPDATE ON \`compliance_legacy_mapping_review_decisions\`
        BEGIN
          SELECT RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_REVIEW_IMMUTABLE'
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_review_no_delete",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_review_no_delete\`
        BEFORE DELETE ON \`compliance_legacy_mapping_review_decisions\`
        BEGIN
          SELECT RAISE(
            ABORT,
            'COMPLIANCE_LEGACY_MAPPING_REVIEW_DELETE_FORBIDDEN'
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_payload_audit",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_payload_audit\`
        AFTER INSERT ON \`compliance_legacy_mapping_artifact_payloads\`
        BEGIN
          INSERT INTO \`compliance_audit_events\` (
            \`id\`,
            \`organisation_id\`,
            \`actor_type\`,
            \`actor_uid\`,
            \`event_type\`,
            \`target_type\`,
            \`target_id\`,
            \`summary\`,
            \`metadata\`,
            \`created_at\`
          ) VALUES (
            'legacy-mapping-artifact:' || NEW.\`artifact_id\`,
            NEW.\`organisation_id\`,
            'compliance',
            NEW.\`created_by_uid\`,
            'legacy_mapping.draft_created',
            'compliance_legacy_mapping_artifact',
            NEW.\`artifact_id\`,
            'Immutable legacy field-mapping draft recorded for review.',
            json_object(
              'legacySystemKey', NEW.\`legacy_system_key\`,
              'mappingVersion', NEW.\`mapping_version\`,
              'artifactSha256', NEW.\`artifact_sha256\`,
              'contractFormat', NEW.\`contract_format\`
            ),
            NEW.\`created_at\`
          );
        END;`,
    },
    {
      name: "compliance_legacy_mapping_review_audit",
      sql: `CREATE TRIGGER IF NOT EXISTS
        \`compliance_legacy_mapping_review_audit\`
        AFTER INSERT ON \`compliance_legacy_mapping_review_decisions\`
        BEGIN
          INSERT INTO \`compliance_audit_events\` (
            \`id\`,
            \`organisation_id\`,
            \`actor_type\`,
            \`actor_uid\`,
            \`event_type\`,
            \`target_type\`,
            \`target_id\`,
            \`summary\`,
            \`metadata\`,
            \`created_at\`
          ) VALUES (
            'legacy-mapping-review:' || NEW.\`id\`,
            NEW.\`organisation_id\`,
            'compliance',
            NEW.\`reviewed_by_uid\`,
            'legacy_mapping.' || NEW.\`decision\`,
            'compliance_legacy_mapping_artifact',
            NEW.\`artifact_id\`,
            'Append-only legacy field-mapping review decision recorded.',
            json_object(
              'legacySystemKey', NEW.\`legacy_system_key\`,
              'mappingVersion', NEW.\`mapping_version\`,
              'artifactSha256', NEW.\`artifact_sha256\`,
              'decision', NEW.\`decision\`,
              'supersedesDecisionId', NEW.\`supersedes_decision_id\`
            ),
            NEW.\`reviewed_at\`
          );
        END;`,
    },
  ]);

const readinessByDatabase = new WeakMap<object, Promise<void>>();

async function installCreditexLegacyMappingGuards(database: D1Database) {
  const requiredObjects = [
    "compliance_legacy_mapping_artifacts",
    "compliance_legacy_mapping_artifact_payloads",
    "compliance_legacy_mapping_review_decisions",
    "compliance_current_legacy_mapping_approvals",
    "compliance_audit_events",
  ];
  const objects = await database.prepare(`SELECT name
    FROM sqlite_schema
    WHERE name IN (${requiredObjects.map(() => "?").join(", ")})`)
    .bind(...requiredObjects)
    .all<{ name: string }>();
  const installedObjects = new Set(
    objects.results.map((record) => String(record.name)),
  );
  const missingObjects = requiredObjects.filter(
    (name) => !installedObjects.has(name),
  );
  if (missingObjects.length) {
    throw new Error(
      `CREDITEX_LEGACY_MAPPING_MIGRATION_REQUIRED:${
        missingObjects.join(",")
      }`,
    );
  }

  const result = await database.prepare(
    "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger'",
  ).all<{ name: string; sql: string | null }>();
  const installed = new Map(
    result.results.map((record) => [
      String(record.name),
      String(record.sql || ""),
    ]),
  );
  const mismatched = CREDITEX_LEGACY_MAPPING_GUARD_DEFINITIONS.filter(
    (definition) => (
      installed.has(definition.name)
      && canonicalCreditexSchemaGuardSql(
        installed.get(definition.name) || "",
      ) !== canonicalCreditexSchemaGuardSql(definition.sql)
    ),
  );
  if (mismatched.length) {
    throw new Error(
      `CREDITEX_LEGACY_MAPPING_GUARD_MISMATCH:${
        mismatched.map((definition) => definition.name).join(",")
      }`,
    );
  }
  const missing = CREDITEX_LEGACY_MAPPING_GUARD_DEFINITIONS.filter(
    (definition) => !installed.has(definition.name),
  );
  if (missing.length) {
    const preseeded = await database.prepare(`SELECT
        (
          SELECT COUNT(*)
          FROM compliance_legacy_mapping_artifacts
          WHERE object_key LIKE
            'd1:compliance_legacy_mapping_artifact_payloads:%'
        )
        + (
          SELECT COUNT(*)
          FROM compliance_legacy_mapping_artifact_payloads
        )
        + (
          SELECT COUNT(*)
          FROM compliance_legacy_mapping_review_decisions
        ) row_count`)
      .first<{ row_count: number }>();
    if (Number(preseeded?.row_count || 0) > 0) {
      throw new Error(
        "CREDITEX_LEGACY_MAPPING_PRESEED_ROWS_BLOCKED",
      );
    }
    await database.batch(
      missing.map((definition) => database.prepare(definition.sql)),
    );
  }
  const verified = await database.prepare(
    "SELECT name FROM sqlite_schema WHERE type = 'trigger'",
  ).all<{ name: string }>();
  const verifiedNames = new Set(
    verified.results.map((record) => String(record.name)),
  );
  const unavailable = CREDITEX_LEGACY_MAPPING_GUARD_DEFINITIONS.filter(
    (definition) => !verifiedNames.has(definition.name),
  );
  if (unavailable.length) {
    throw new Error(
      `CREDITEX_LEGACY_MAPPING_GUARD_INSTALL_FAILED:${
        unavailable.map((definition) => definition.name).join(",")
      }`,
    );
  }
}

export async function ensureCreditexLegacyMappingGuards(
  database: D1Database,
) {
  const key = database as unknown as object;
  const existing = readinessByDatabase.get(key);
  if (existing) return existing;
  const pending = installCreditexLegacyMappingGuards(database);
  readinessByDatabase.set(key, pending);
  try {
    await pending;
  } catch (error) {
    readinessByDatabase.delete(key);
    throw error;
  }
}
