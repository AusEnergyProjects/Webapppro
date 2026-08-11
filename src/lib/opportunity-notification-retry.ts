const RETRY_DELAYS_MINUTES = [5, 30, 120, 240, 480, 960, 1_440] as const;

export const OPPORTUNITY_NOTIFICATION_RETRYABLE_STATUS_SQL =
  "'pending', 'failed', 'waiting_for_channel'";

export const OPPORTUNITY_NOTIFICATION_MANUAL_RETRY_STATUS_SQL =
  "'failed', 'waiting_for_channel'";

export const OPPORTUNITY_NOTIFICATION_CLAIM_GUARD_SQL =
  "id = ? AND status = ? AND attempts = ?";

export const OPPORTUNITY_NOTIFICATION_ENSURE_DELIVERIES_SQL = `INSERT OR IGNORE INTO trade_opportunity_notification_deliveries
  (id, match_id, status, eligibility_reason, attempts, next_attempt_at,
   provider, provider_message_id, provider_status, recipient_email_hash,
   idempotency_key, subject, body, enqueued_at, last_attempt_at, sent_at,
   delivered_at, failed_at, last_error, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), assignment.id, 'pending', '', 0, '',
    'resend', '', '', '', '', '', '', assignment.matched_at, '', '', '', '', '',
    assignment.matched_at, ?
  FROM trade_opportunity_matches assignment
  LEFT JOIN trade_opportunity_notification_deliveries delivery
    ON delivery.match_id = assignment.id
  WHERE assignment.opportunity_id = ?
    AND assignment.status IN ('offered', 'viewed', 'interested', 'connected')
    AND delivery.id IS NULL`;

export function opportunityNotificationRetryAt(attempts: number, now = Date.now()) {
  const attemptIndex = Math.max(0, Math.floor(Number(attempts) || 1) - 1);
  const minutes = RETRY_DELAYS_MINUTES[
    Math.min(attemptIndex, RETRY_DELAYS_MINUTES.length - 1)
  ];
  return new Date(now + minutes * 60 * 1000).toISOString();
}

export function opportunityNotificationFailureAudit(attempts: number) {
  const escalated = Number(attempts) >= 4;
  return {
    eventType: escalated ? "provider_retry_escalated" : "provider_attempt_failed",
    providerStatus: escalated ? "long_lived_retry_scheduled" : "retry_scheduled",
    summary: escalated
      ? "Repeated transient provider failure; bounded long-lived retry remains scheduled."
      : "Transient provider failure; retry scheduled.",
  } as const;
}

export function shouldDrainOpportunityNotificationBacklog(input: {
  method: string;
  pathname: string;
  responseOk: boolean;
}) {
  if (!input.responseOk) return false;
  if (input.method === "POST" && input.pathname === "/api/leads") return true;
  return input.method === "GET" && [
    "/api/health",
    "/api/trade-opportunities",
    "/api/trade-job-notifications",
  ].includes(input.pathname);
}

export function takeOpportunityNotificationDispatch(
  response: Response,
  headerName: string,
) {
  const opportunityId = response.headers.get(headerName) || "";
  if (!opportunityId) return { opportunityId: "", response };
  const headers = new Headers(response.headers);
  headers.delete(headerName);
  return {
    opportunityId,
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  };
}
