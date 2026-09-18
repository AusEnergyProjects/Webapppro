import { apiRequest } from '@/lib/api';

export type TrainingSource = { id: string; title: string; url: string };
export type TrainingModule = {
  id: string; programCode: string; version: string | number; title: string; activityTemplateIds: string[];
  estimatedMinutes: number; passPercent: number; availability: string; status: string;
  lessons: { title: string; body: string; sourceIds: string[] }[]; sources: TrainingSource[];
  completion: null | { reference: string; passedAt: string; expiresAt: string; revokedAt: string };
};
export type TrainingOverview = {
  ok: boolean;
  business: { approved: boolean; status: string; blockedReasons: string[] };
  memberId: string;
  modules: TrainingModule[];
  unavailableActivities: { id: string; title: string; programCode: string; message: string }[];
};
export type TrainingAttempt = {
  id: string; moduleId: string; version: string | number; expiresAt: string;
  questions: { id: string; prompt: string; options: { id: string; text: string }[]; critical: boolean }[];
};
export type TrainingResult = {
  passed: boolean; scorePercent: number; criticalPassed: boolean; reference: string; expiresAt: string;
  feedback: { questionId: string; prompt: string; correct: boolean; explanation: string; sourceIds: string[]; correctAnswer: string }[];
};

// apiRequest uses the existing device-bound TLinkField session, including for PIN-only workers.
// Training is online and held in memory; it is never placed in the offline job or upload queue.
export function loadTrainingOverview() {
  return apiRequest<TrainingOverview>('/api/trade-training', { cache: 'no-store' });
}
export async function startTrainingAssessment(moduleId: string) {
  const result = await apiRequest<{ ok: boolean; attempt: TrainingAttempt }>('/api/trade-training', {
    method: 'POST', body: JSON.stringify({ action: 'start', moduleId }),
  });
  return result.attempt;
}
export async function submitTrainingAssessment(attemptId: string, answers: Record<string, string>) {
  const result = await apiRequest<{ ok: boolean; result: TrainingResult }>('/api/trade-training', {
    method: 'POST', body: JSON.stringify({ action: 'submit', attemptId, answers }),
  });
  return result.result;
}
