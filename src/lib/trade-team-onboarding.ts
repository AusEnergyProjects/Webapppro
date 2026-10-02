export type TeamOnboardingTraining = {
  memberId: string;
  officeOnly: boolean;
  modules: Array<{ status: string; expiresAt: string; businessServiceEnabled: boolean }>;
};

type Member = {
  id: string;
  status: string;
  hasLogin: boolean;
  lastActiveAt?: string;
  invitePending: boolean;
  email: string;
};

export type TeamOnboardingTarget = "access" | "training" | "contact" | "";

export type TeamOnboardingStep = {
  kind: "inactive" | "join" | "training" | "current";
  label: string;
  detail: string;
  action: string;
  target: TeamOnboardingTarget;
};

/** A setup guide, not a job eligibility decision. The booking checks remain authoritative. */
export function teamOnboardingStep(member: Member, training: TeamOnboardingTraining | undefined, now = Date.now()): TeamOnboardingStep {
  if (member.status !== "active") return { kind: "inactive", label: "Access inactive", detail: "Reinstate access before assigning new work.", action: "View details", target: "" };
  if (!member.hasLogin && !member.lastActiveAt) {
    if (!member.email) return { kind: "join", label: "Contact needed", detail: "Add an email to invite this person, or keep them on the roster only.", action: "Add email", target: "contact" };
    if (member.invitePending) return { kind: "join", label: "Waiting to join", detail: "They can accept their invitation. App users can use their emailed setup PIN.", action: "View invitation", target: "access" };
    return { kind: "join", label: "Sign-in setup", detail: "Send an invitation or set up their app access.", action: "Set up access", target: "access" };
  }
  if (!training || training.memberId !== member.id) return { kind: "training", label: "Joined", detail: "Open their saved training to check the next step.", action: "Check training", target: "training" };
  if (training.officeOnly) return { kind: "current", label: "Office setup ready", detail: "Joined. No on-site training assigned. They can use their permitted office tools.", action: "View details", target: "" };
  const outstanding = training.modules.filter(module => module.status !== "passed" || !Number.isFinite(Date.parse(module.expiresAt)) || Date.parse(module.expiresAt) <= now).length;
  if (outstanding) return { kind: "training", label: "Training to complete", detail: `${outstanding} of ${training.modules.length} assigned modules need a current pass. Each person completes their own training.`, action: "View training", target: "training" };
  if (!training.modules.length) return { kind: "training", label: "Check service requirements", detail: "No activity modules are listed. Review the saved services and regions before assigning program work.", action: "Review training", target: "training" };
  if (training.modules.some(module => !module.businessServiceEnabled)) return { kind: "training", label: "Business setup needed", detail: "Training passes are current, but a related business service is not enabled.", action: "Review training", target: "training" };
  return { kind: "current", label: "Training current", detail: "Joined and assigned training passes are current. Check licences and job requirements when assigning work.", action: "View training", target: "training" };
}
