"use client";

import { useCallback, useEffect, useState } from "react";

export type WorkspaceNoticeKind = "success" | "progress" | "warning" | "error";
type WorkspaceNotice = { message: string; kind: WorkspaceNoticeKind; calendarRetry: boolean };

export function useWorkspaceNotice(navigationKey: string) {
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);
  const [previousNavigationKey, setPreviousNavigationKey] = useState(navigationKey);
  const setStatus = useCallback((message: string, kind: WorkspaceNoticeKind, calendarRetry = false) => {
    setNotice({ message, kind, calendarRetry });
  }, []);
  const dismissStatus = useCallback(() => setNotice(null), []);

  if (previousNavigationKey !== navigationKey) {
    setPreviousNavigationKey(navigationKey);
    if (notice?.kind === "success") setNotice(null);
  }

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = setTimeout(() => {
      setNotice(current => current === notice ? null : current);
    }, 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  return { notice, setStatus, dismissStatus };
}
