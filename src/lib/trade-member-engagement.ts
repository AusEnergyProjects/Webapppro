export type MemberEngagementBusiness = { businessName: string; abn: string; address: string };
export type MemberEngagement = {
  engagementType: "" | "employee" | "contractor";
  rateBasis: "" | "hourly" | "annual_salary" | "per_job";
  rateAmount: string;
  paymentMethod: "" | "bank_transfer" | "cash" | "other";
  paymentFrequency: "" | "weekly" | "fortnightly" | "monthly" | "per_job" | "by_agreement";
  startDate: string;
  bankAccountName: string;
  bankBsb: string;
  bankAccountNumber: string;
  superFundName: string;
  superUsi: string;
  superMemberNumber: string;
};

export const emptyMemberEngagement: MemberEngagement = {
  engagementType: "", rateBasis: "", rateAmount: "", paymentMethod: "", paymentFrequency: "", startDate: "",
  bankAccountName: "", bankBsb: "", bankAccountNumber: "", superFundName: "", superUsi: "", superMemberNumber: "",
};

export class MemberEngagementError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function text(value: unknown, label: string, max = 180) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new MemberEngagementError(400, `Check ${label}.`);
  return value.trim();
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.some(choice => choice === value)) throw new MemberEngagementError(400, `Choose ${label}.`);
  return choices.find(choice => choice === value)!;
}

export function parseMemberEngagement(input: unknown): MemberEngagement {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MemberEngagementError(400, "Check the pay and onboarding details.");
  const source = Object.fromEntries(Object.entries(input));
  if (Object.keys(source).some(key => !Object.hasOwn(emptyMemberEngagement, key))) throw new MemberEngagementError(400, "The pay and onboarding details contain an unsupported field.");
  const rateAmount = text(source.rateAmount, "the agreed amount", 15);
  if (rateAmount && (!/^\d{1,9}(?:\.\d{1,2})?$/.test(rateAmount) || Number(rateAmount) <= 0)) throw new MemberEngagementError(400, "Use a positive AUD amount with no more than two decimal places.");
  const rateBasis = choice(source.rateBasis, ["", "hourly", "annual_salary", "per_job"], "a pay basis");
  if (Boolean(rateBasis) !== Boolean(rateAmount)) throw new MemberEngagementError(400, "Choose a pay basis and agreed amount together, or leave both blank.");
  const startDate = text(source.startDate, "the start date", 10);
  if (startDate && (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(Date.parse(`${startDate}T00:00:00Z`)) || new Date(`${startDate}T00:00:00Z`).toISOString().slice(0, 10) !== startDate)) throw new MemberEngagementError(400, "Choose a valid start date.");
  const bankBsb = text(source.bankBsb, "the BSB", 12).replace(/[ -]/g, "");
  const bankAccountNumber = text(source.bankAccountNumber, "the bank account number", 20).replace(/ /g, "");
  if (bankBsb && !/^\d{6}$/.test(bankBsb)) throw new MemberEngagementError(400, "The BSB must contain six digits.");
  if (bankAccountNumber && !/^\d{4,12}$/.test(bankAccountNumber)) throw new MemberEngagementError(400, "The bank account number must contain 4 to 12 digits.");
  return {
    engagementType: choice(source.engagementType, ["", "employee", "contractor"], "an engagement type"), rateBasis,
    rateAmount: rateAmount ? (Math.round(Number(rateAmount) * 100) / 100).toFixed(2) : "",
    paymentMethod: choice(source.paymentMethod, ["", "bank_transfer", "cash", "other"], "a payment method"),
    paymentFrequency: choice(source.paymentFrequency, ["", "weekly", "fortnightly", "monthly", "per_job", "by_agreement"], "a payment frequency"),
    startDate, bankAccountName: text(source.bankAccountName, "the bank account name"), bankBsb, bankAccountNumber,
    superFundName: text(source.superFundName, "the super fund name"), superUsi: text(source.superUsi, "the fund USI", 80),
    superMemberNumber: text(source.superMemberNumber, "the super member number", 80),
  };
}
