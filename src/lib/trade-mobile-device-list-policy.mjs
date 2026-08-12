const DEVICE_STATUSES = new Set(["active", "revoked"]);

export function normaliseDeviceListQuery(searchParams) {
  const requestedPage = Number(searchParams.get("page"));
  const requestedPageSize = Number(searchParams.get("pageSize"));
  const search = String(searchParams.get("search") || "").trim().slice(0, 100);
  const requestedStatus = String(searchParams.get("status") || "").trim();
  const memberId = String(searchParams.get("memberId") || "").trim().slice(0, 180);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
    ? Math.min(requestedPageSize, 100)
    : 25;
  const escapedSearch = search.toLowerCase().replace(/[\\%_]/g, "\\$&");
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    search,
    searchLike: escapedSearch ? `%${escapedSearch}%` : "",
    status: DEVICE_STATUSES.has(requestedStatus) ? requestedStatus : "",
    memberId,
  };
}
