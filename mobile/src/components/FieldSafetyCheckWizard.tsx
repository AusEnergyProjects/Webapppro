import { FieldOfficialAssessmentWizard } from './FieldVeuElectricalAssessmentWizard';

export function FieldSafetyCheckWizard(props: {
  workOrderId: string; recordId: string; online: boolean;
  onReturnToJob: () => void; onChanged: () => Promise<void>;
}) {
  return <FieldOfficialAssessmentWizard {...props} service="safety" />;
}
