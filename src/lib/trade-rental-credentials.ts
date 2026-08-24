type Row = Record<string, unknown>;

export type RentalCredentialSnapshot = {
  schemaVersion: "tlink-rental-module-credential-v1";
  gate: string;
  moduleKey: string;
  assessorMemberId: string;
  assessorName: string;
  credentialType: string;
  credentialName: string;
  credentialNumber: string;
  issuer: string;
  jurisdiction: string;
  expiresAt: string;
  supportingFileName: string;
  supportingFileTitle: string;
  supportingFileSha256: string;
  supportingFileRecordedAt: string;
  verificationBasis: "assessor_declaration" | "manager_attested_document";
  recordedAt: string;
  confirmedAt: string;
};

const OPTIONAL_GATES = new Set([
  "licensed_electrician",
  "licensed_gasfitter",
  "suitably_qualified_smoke_alarm_worker",
]);

function parsedObject(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
  } catch {
    return {};
  }
}

function text(value: unknown) {
  return String(value || "").trim();
}

function comparableName(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

function asserted(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function credentialNumber(moduleKey: string, answers: Row) {
  return moduleKey === "electrical_safety_check" || moduleKey === "gas_safety_check"
    ? text(answers.licenceNumber)
    : text(answers.qualificationNumber);
}

function declaredCredentialName(moduleKey: string, answers: Row) {
  if (moduleKey === "electrical_safety_check") return text(answers.electricianName);
  if (moduleKey === "gas_safety_check") return text(answers.gasfitterName);
  if (moduleKey === "smoke_alarm_check") return text(answers.workerName);
  return text(answers.qualificationType);
}

function baseSnapshot(input: {
  moduleKey: string;
  gate: string;
  assessorMemberId: string;
  assessorName: string;
  confirmedAt: string;
}) {
  return {
    schemaVersion: "tlink-rental-module-credential-v1" as const,
    gate: input.gate,
    moduleKey: input.moduleKey,
    assessorMemberId: input.assessorMemberId,
    assessorName: input.assessorName,
    confirmedAt: input.confirmedAt,
  };
}

export async function currentRentalModuleCredentialSnapshot(input: {
  db: D1Database;
  ownerUid: string;
  assessorMemberId: string;
  moduleKey: string;
  requiredCapability: string;
  answers: unknown;
  confirmedAt: string;
}): Promise<RentalCredentialSnapshot> {
  const answers = parsedObject(input.answers);
  if (!asserted(answers.credentialConfirmed) || !asserted(answers.assessorDeclaration)) {
    throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  }
  const member = await input.db.prepare(`SELECT id, display_name, first_name, last_name
    FROM trade_team_members WHERE id = ? AND owner_uid = ? AND status = 'active' LIMIT 1`)
    .bind(input.assessorMemberId, input.ownerUid).first<Row>();
  if (!member) throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  const assessorName = [text(member.first_name), text(member.last_name)].filter(Boolean).join(" ")
    || text(member.display_name);
  if (!assessorName || !input.confirmedAt) throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  const shared = baseSnapshot({
    moduleKey: input.moduleKey,
    gate: input.requiredCapability,
    assessorMemberId: input.assessorMemberId,
    assessorName,
    confirmedAt: input.confirmedAt,
  });

  if (input.moduleKey === "minimum_standards" && input.requiredCapability === "qualified_assessor") {
    const type = text(answers.qualificationType);
    const number = text(answers.qualificationNumber);
    if (!type || !number) throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
    return {
      ...shared,
      credentialType: type,
      credentialName: type,
      credentialNumber: number,
      issuer: "Assessor declared",
      jurisdiction: "VIC",
      expiresAt: "",
      supportingFileName: "",
      supportingFileTitle: "",
      supportingFileSha256: "",
      supportingFileRecordedAt: "",
      verificationBasis: "assessor_declaration",
      recordedAt: input.confirmedAt,
    };
  }

  if (!OPTIONAL_GATES.has(input.requiredCapability)) throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  const number = credentialNumber(input.moduleKey, answers);
  const workerName = declaredCredentialName(input.moduleKey, answers);
  if (!number || !workerName) throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  if (comparableName(workerName) !== comparableName(assessorName)) {
    throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  }
  const credential = await input.db.prepare(`SELECT credential.credential_type, credential.name,
      credential.credential_number, credential.issuer, credential.jurisdiction,
      credential.expires_at, credential.updated_at,
      file.file_name, file.title file_title, file.sha256 file_sha256, file.updated_at file_updated_at
    FROM trade_team_member_credentials credential
    JOIN trade_team_member_files file ON file.id = credential.file_id
      AND file.owner_uid = credential.owner_uid AND file.team_member_id = credential.team_member_id
    WHERE credential.owner_uid = ? AND credential.team_member_id = ?
      AND credential.rental_gate = ? AND credential.status = 'active'
      AND credential.jurisdiction IN ('VIC', 'NATIONAL')
      AND upper(trim(credential.credential_number)) = upper(trim(?))
      AND credential.expires_at <> '' AND date(credential.expires_at) >= date(?)
      AND file.status = 'active' AND file.expires_at <> '' AND date(file.expires_at) >= date(?)
    ORDER BY credential.updated_at DESC, credential.id DESC LIMIT 1`)
    .bind(input.ownerUid, input.assessorMemberId, input.requiredCapability, number,
      input.confirmedAt.slice(0, 10), input.confirmedAt.slice(0, 10)).first<Row>();
  if (!credential) throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  const type = text(credential.credential_type);
  if ((input.requiredCapability === "licensed_electrician" || input.requiredCapability === "licensed_gasfitter")
    && !["licence", "registration"].includes(type)) {
    throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  }
  if (input.requiredCapability === "suitably_qualified_smoke_alarm_worker"
    && !["licence", "registration", "training"].includes(type)) {
    throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  }
  return {
    ...shared,
    credentialType: type,
    credentialName: text(credential.name),
    credentialNumber: text(credential.credential_number),
    issuer: text(credential.issuer),
    jurisdiction: text(credential.jurisdiction),
    expiresAt: text(credential.expires_at),
    supportingFileName: text(credential.file_name),
    supportingFileTitle: text(credential.file_title),
    supportingFileSha256: text(credential.file_sha256),
    supportingFileRecordedAt: text(credential.file_updated_at),
    verificationBasis: "manager_attested_document",
    recordedAt: text(credential.updated_at),
  };
}

export async function assertRentalModuleCredentialCurrent(input: {
  db: D1Database;
  ownerUid: string;
  assessorMemberId: string;
  moduleKey: string;
  requiredCapability: string;
  answers: unknown;
  storedSnapshot: unknown;
  completedAt: string;
  checkedAt: string;
}) {
  const stored = parsedObject(input.storedSnapshot);
  if (stored.schemaVersion !== "tlink-rental-module-credential-v1") {
    throw new Error("RENTAL_MODULE_CREDENTIAL_REQUIRED");
  }
  const current = await currentRentalModuleCredentialSnapshot({
    db: input.db,
    ownerUid: input.ownerUid,
    assessorMemberId: input.assessorMemberId,
    moduleKey: input.moduleKey,
    requiredCapability: input.requiredCapability,
    answers: input.answers,
    confirmedAt: input.completedAt,
  });
  if (JSON.stringify(current) !== JSON.stringify(stored)) {
    throw new Error("RENTAL_MODULE_CREDENTIAL_CHANGED");
  }
  if (current.verificationBasis === "manager_attested_document") {
    let currentAtIssue: RentalCredentialSnapshot;
    try {
      currentAtIssue = await currentRentalModuleCredentialSnapshot({
        db: input.db,
        ownerUid: input.ownerUid,
        assessorMemberId: input.assessorMemberId,
        moduleKey: input.moduleKey,
        requiredCapability: input.requiredCapability,
        answers: input.answers,
        confirmedAt: input.checkedAt,
      });
    } catch {
      throw new Error("RENTAL_MODULE_CREDENTIAL_CHANGED");
    }
    if (JSON.stringify({ ...currentAtIssue, confirmedAt: current.confirmedAt }) !== JSON.stringify(current)) {
      throw new Error("RENTAL_MODULE_CREDENTIAL_CHANGED");
    }
  }
  return current;
}
