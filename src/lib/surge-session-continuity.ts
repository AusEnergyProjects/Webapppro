export type SurgeSessionContinuityMetrics = {
  reviewedAnswers: number;
  knownAnswers: number;
  completed: boolean;
  conversationActivityAt: number;
  profileUpdatedAt: number;
};

export function preferSurgeConversation(
  candidate: SurgeSessionContinuityMetrics,
  current: SurgeSessionContinuityMetrics,
) {
  if (candidate.reviewedAnswers !== current.reviewedAnswers) return candidate.reviewedAnswers > current.reviewedAnswers;
  if (candidate.knownAnswers !== current.knownAnswers) return candidate.knownAnswers > current.knownAnswers;
  if (candidate.completed !== current.completed) return candidate.completed;
  return candidate.conversationActivityAt > current.conversationActivityAt;
}

export function preferSurgeProfile(
  candidate: SurgeSessionContinuityMetrics,
  current: SurgeSessionContinuityMetrics,
) {
  if (candidate.reviewedAnswers !== current.reviewedAnswers) return candidate.reviewedAnswers > current.reviewedAnswers;
  if (candidate.knownAnswers !== current.knownAnswers) return candidate.knownAnswers > current.knownAnswers;
  if (candidate.completed !== current.completed) return candidate.completed;
  return candidate.profileUpdatedAt > current.profileUpdatedAt;
}

export function selectPreferredSurgeSession<T>(
  sessions: readonly T[],
  metricsFor: (session: T) => SurgeSessionContinuityMetrics,
) {
  return sessions.reduce<T | null>((preferred, session) => (
    !preferred || preferSurgeConversation(metricsFor(session), metricsFor(preferred)) ? session : preferred
  ), null);
}
