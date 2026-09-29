// Integer millionths of AUD preserve the 9c + GST price without rounding each text.
export const SMS_PART_PRICE_MICRO = 99_000;
export const SMS_TOP_UP_CENTS = [5000, 10000, 20000] as const;
export const SMS_PRICE_LABEL = "9¢ + GST per SMS part";
export function smsTopUpAmount(value: unknown) {
  if (typeof value !== "number" || !SMS_TOP_UP_CENTS.some(amount => amount === value)) throw new Error("SMS_TOPUP_INVALID");
  return value;
}
export function smsRequestId(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(value)) throw new Error("SMS_REQUEST_ID_REQUIRED");
  return value;
}
export function nextSmsRentalDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("SMS_RENTAL_DATE_INVALID");
  // ClickSend renews on the first of the month in AEST (UTC+10).
  const local = new Date(date.getTime() + 10 * 60 * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 10 * 60 * 60 * 1000).toISOString();
}
export type SmsRegistration = { businessName: string; address: string; suburb: string; state: string; postcode: string; contactName: string; phone: string; email: string; useCase: string };
export function smsRegistration(value: unknown): SmsRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SMS_REGISTRATION_INVALID");
  const row = value as Record<string, unknown>;
  const field = (key: string, max: number) => {
    const v = row[key];
    if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw new Error("SMS_REGISTRATION_INVALID");
    return v.trim();
  };
  const result = {businessName:field("businessName",100),address:field("address",150),suburb:field("suburb",50),state:field("state",3),postcode:field("postcode",4),contactName:field("contactName",100),phone:field("phone",30),email:field("email",254),useCase:field("useCase",400)};
  if (!/^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(result.state) || !/^\d{4}$/.test(result.postcode) || /\bp\.?\s*o\.?\s*box\b|\bpost\s+office\s+box\b/i.test(result.address)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new Error("SMS_REGISTRATION_INVALID");
  const phone = result.phone.replace(/[\s()-]/g, "").replace(/^0/, "+61").replace(/^61/, "+61");
  if (!/^\+614\d{8}$/.test(phone)) throw new Error("SMS_REGISTRATION_INVALID");
  return {...result,phone};
}
