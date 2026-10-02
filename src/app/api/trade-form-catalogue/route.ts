import { getD1 } from '../../../../db';
import { adminJson, sameOrigin, mfaErrorResponse } from '@/lib/admin-server';
import { requireInstallerTeamAccess } from '@/lib/trade-team-server';
import { TradeBusinessContextError } from '@/lib/trade-business-context-server';
import { resolveActiveCreditexOfficialSourceOrganisation } from '@/lib/creditex-official-source-custody-server';
import { activityFieldCatalogue, defaultActivityFieldForm, applyDefaultActivityFormPolicy } from '@/lib/trade-activity-forms-library';
export const runtime = 'edge';
export const dynamic = 'force-dynamic';
/** Definitions only. Never expose master drafts, job answers or another business's records. */
export async function GET(request: Request) {
  if (!sameOrigin(request)) return adminJson({ ok: false, error: 'Request origin was not accepted.' }, 403);
  try {
    await requireInstallerTeamAccess(request);
    const query = new URL(request.url).searchParams;
    const catalogue = activityFieldCatalogue();
    const id = query.get('activityTemplateId');
    if (!id) return adminJson({ ok: true, catalogue });
    if (!catalogue.some(item => item.activityTemplateId === id)) return adminJson({ ok: false, error: 'Form not found.' }, 404);
    const database = getD1();
    const organisationId = await resolveActiveCreditexOfficialSourceOrganisation(database);
    const builtIn = defaultActivityFieldForm(id, query.get('variantId') || '');
    const saved = await database.prepare(`SELECT form_json FROM trade_activity_field_masters
      WHERE organisation_id = ? AND activity_template_id = ? AND variant_id = ? ORDER BY version DESC LIMIT 1`)
      .bind(organisationId, id, builtIn.variantId).first<{ form_json: string }>();
    return adminJson({ ok: true, form: applyDefaultActivityFormPolicy(saved ? JSON.parse(saved.form_json) : builtIn, builtIn) });
  } catch (error) {
    const mfa = mfaErrorResponse(error); if (mfa) return mfa;
    if (error instanceof TradeBusinessContextError) return adminJson({ ok: false, error: error.publicMessage }, error.status);
    const code = error instanceof Error ? error.message : '';
    if (/AUTH|TOKEN|TEAM_ACCESS|TRADE_ACCESS|EMAIL_VERIFICATION/.test(code)) return adminJson({ ok: false, error: 'Sign in with an active TLink business account.' }, 403);
    return adminJson({ ok: false, error: 'Compliance forms could not be loaded. Try again.' }, 503);
  }
}
