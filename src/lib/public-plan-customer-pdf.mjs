import {
  createPublicPlanCustomerReportView,
} from "./customer-plan-document.mjs";
import {
  CustomerPlanPdfUnsupportedTextError,
  createCustomerPlanPdfBytes,
} from "./customer-plan-pdf.mjs";

const NEUTRAL_CUSTOMER_NAME = "Customer";
const NEUTRAL_CUSTOMER_PRIVACY_NOTE = "This personalised copy is emailed only to the customer and uses a neutral cover label because the current PDF font cannot display every character in the customer's name. The real name remains in the private enquiry. The PDF excludes street address, contact details, bills, meter identifiers, usage files, account records, uploaded documents and private trade notes.";

function unsupportedTextIsOnlyInName(error, name) {
  if (!(error instanceof CustomerPlanPdfUnsupportedTextError)) return false;
  const nameCharacters = new Set(Array.from(String(name || "")));
  return error.unsupportedCharacters.length > 0
    && error.unsupportedCharacters.every((character) =>
      nameCharacters.has(character)
    );
}

/**
 * Build the one canonical public-plan report and PDF used by both the emailed
 * attachment and the post-submit download. A neutral cover label is used only
 * when the customer's name is the sole text outside the bundled font coverage.
 * The real name remains in the private lead record.
 *
 * @param {{
 *   snapshot: Record<string, unknown>,
 *   name?: string,
 *   postcode?: string,
 *   projectCategories?: string[],
 *   preparedAt?: string,
 * }} input
 * @param {{regular: Uint8Array, bold: Uint8Array}} fonts
 */
export async function createPublicPlanCustomerPdfBundle(input, fonts) {
  let report = createPublicPlanCustomerReportView(input);
  let bytes;
  try {
    bytes = await createCustomerPlanPdfBytes(report, fonts);
  } catch (error) {
    if (!unsupportedTextIsOnlyInName(error, input?.name)) throw error;
    report = {
      ...createPublicPlanCustomerReportView({
        ...input,
        name: NEUTRAL_CUSTOMER_NAME,
      }),
      privacyNote: NEUTRAL_CUSTOMER_PRIVACY_NOTE,
    };
    bytes = await createCustomerPlanPdfBytes(report, fonts);
  }
  return { report, bytes };
}
