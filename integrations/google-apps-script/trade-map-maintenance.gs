/** Background address preparation. Install in the existing operations relay project. */
function setupTradeMapMaintenance() {
  const existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === "runTradeMapMaintenance";
  });
  if (existing.length > 1) throw new Error("Duplicate map maintenance triggers require review");
  if (existing.length === 0) {
    ScriptApp.newTrigger("runTradeMapMaintenance").timeBased().everyMinutes(1).create();
  }
  return { installed: true };
}

function runTradeMapMaintenance() {
  const secret = PropertiesService.getScriptProperties().getProperty("AEA_LEAD_WEBHOOK_TEST_TOKEN") || "";
  if (secret.length < 32) throw new Error("Operations authentication is not configured");
  const timestamp = String(Date.now());
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    "tlink-map-maintenance\n" + timestamp, secret
  )).replace(/=+$/, "");
  const response = UrlFetchApp.fetch("https://ausenergyassessments.com/api/internal/trade-map-maintenance", {
    method: "post",
    muteHttpExceptions: true,
    followRedirects: false,
    headers: {
      Accept: "application/json",
      "X-TLink-Maintenance-Timestamp": timestamp,
      "X-TLink-Maintenance-Signature": signature,
    },
  });
  const status = response.getResponseCode();
  if (status !== 202) throw new Error("Map maintenance returned HTTP " + status);
  // The server continues its bounded batch after acknowledging the request.
  // No customer details or credentials are sent to execution logs.
  console.log(JSON.stringify({ event: "map.maintenance", status: "accepted" }));
  return { accepted: true };
}
