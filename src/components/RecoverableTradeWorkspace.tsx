"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

export function recoverableTradeWorkspace<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
  auto = true,
) {
  const key = "tlinkRetry";
  return dynamic<Props>(async () => {
    try {
      const Screen = await load();
      try { sessionStorage.removeItem(key); } catch {}
      return Screen;
    } catch {
      if (auto) try {
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          location.reload();
        }
      } catch {}
      return function TradeWorkspaceLoadFailure() {
        return <div className="crm-empty" role="alert"><strong>Screen failed to load</strong><button type="button" onClick={() => location.reload()}>Reload</button></div>;
      };
    }
  }, { loading: () => <p>Opening...</p> });
}
