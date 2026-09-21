import { getD1 } from '../../../../db';
import { requireAdminIdentity, sameOrigin } from '@/lib/admin-server';
import { readBoundedJsonRequest } from '@/lib/bounded-json-request';
import { creditexApiError, creditexJson, requireCreditexTrainingReviewer } from '@/lib/creditex-onboarding-api';
import { CreditexComplianceError, record, textField } from '@/lib/creditex-onboarding-server';
import { GOVERNMENT_PROGRAM_TEMPLATES } from '@/lib/australian-government-program-catalogue';
import { ENERGY_SERVICE_CATALOGUE } from '@/lib/energy-service-catalogue.mjs';
import { deleteTrainingQuestionnaireDraft, getTrainingQuestionnaire, getTrainingSubmission, listTrainingQuestionnaires, listTrainingQuestionnaireVersions, listTrainingSubmissionPeople, listTrainingSubmissions, publishTrainingQuestionnaire, retireTrainingQuestionnaire, saveTrainingQuestionnaire } from '@/lib/training-questionnaire-store';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
async function requireQuestionnaireEditor(request: Request) {
  try { return await requireAdminIdentity(request, ['owner', 'admin', 'reviewer']); }
  catch (error) {
    // A valid Creditex reviewer need not also hold an internal operations account.
    if (!(error instanceof Error) || !['ADMIN_REQUIRED', 'ROLE_REQUIRED'].includes(error.message)) throw error;
    return requireCreditexTrainingReviewer(request);
  }
}
function apiError(error: unknown) {
  if (error instanceof Error && ['ADMIN_SUSPENDED', 'ROLE_REQUIRED', 'EMAIL_VERIFICATION_REQUIRED'].includes(error.message)) return creditexJson({ ok: false, code: error.message, error: 'An active authorised training editor account is required.' }, 403);
  return creditexApiError(error);
}
export async function GET(request: Request) {
  try {
    await requireQuestionnaireEditor(request); const db = getD1(); const params = new URL(request.url).searchParams;
    const submissionId = textField(params.get('submissionId'), 100); if (submissionId) return creditexJson({ ok: true, submission: await getTrainingSubmission(db, submissionId) });
    const moduleId = textField(params.get('moduleId'), 100);
    if (moduleId) {
      const [questionnaire, versions, submissions] = await Promise.all([getTrainingQuestionnaire(db, moduleId), listTrainingQuestionnaireVersions(db, moduleId), listTrainingSubmissions(db, { moduleId })]);
      return creditexJson({ ok: true, questionnaire, versions, submissions });
    }
    if (params.get('view') === 'submissions') {
      const [people, submissions] = await Promise.all([listTrainingSubmissionPeople(db), listTrainingSubmissions(db, { ownerUid: textField(params.get('ownerUid'), 160), memberId: textField(params.get('memberId'), 100), beforeCompletedAt: textField(params.get('beforeCompletedAt'), 40), beforeId: textField(params.get('beforeId'), 100) })]);
      const last = submissions.at(-1);
      return creditexJson({ ok: true, people, submissions, nextCursor: submissions.length === 200 && last ? { completedAt: last.completedAt, id: last.id } : null });
    }
    return creditexJson({ ok: true, modules: await listTrainingQuestionnaires(db), programs: GOVERNMENT_PROGRAM_TEMPLATES.map(({ programCode, name, jurisdiction }) => ({ programCode, name, jurisdiction })), services: ENERGY_SERVICE_CATALOGUE });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return creditexJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    const editor = await requireQuestionnaireEditor(request); const body = record(await readBoundedJsonRequest(request, 512 * 1024)); const db = getD1();
    if (body.action === 'save_draft') return creditexJson({ ok: true, questionnaire: await saveTrainingQuestionnaire(db, editor.uid, body) });
    if (body.action === 'publish') return creditexJson({ ok: true, questionnaire: await publishTrainingQuestionnaire(db, editor.uid, body) });
    if (body.action === 'delete_draft') return creditexJson({ ok: true, ...await deleteTrainingQuestionnaireDraft(db, editor.uid, body) });
    if (body.action === 'delete_module') return creditexJson({ ok: true, ...await retireTrainingQuestionnaire(db, editor.uid, body) });
    throw new CreditexComplianceError('ACTION_INVALID', 'Choose save draft, publish or delete a training module.', 400);
  } catch (error) { return apiError(error); }
}
