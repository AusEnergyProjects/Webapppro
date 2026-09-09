export function customerAccountRetired() {
  return Response.json({
    ok: false,
    code: "CUSTOMER_ACCOUNTS_RETIRED",
    error: "Customer accounts have closed. Use the home energy planner or send an enquiry without an account.",
    next: "/direct-trade",
  }, { status: 410, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export function retiredProjectPlannerPath(query = {}) {
  const parameters = new URLSearchParams();
  for (const key of ["goal", "feature", "pace", "situation", "approvalContext", "budgetRange", "postcode", "addressState"]) {
    const value = query[key];
    for (const entry of (Array.isArray(value) ? value : [value]).slice(0, 20)) {
      if (typeof entry === "string" && entry.length <= 80) parameters.append(key, entry);
    }
  }
  return `/plan${parameters.size ? `?${parameters}` : ""}`;
}
