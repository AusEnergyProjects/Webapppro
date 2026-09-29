"use client";

import type { User } from "firebase/auth";
import { TradeSmsDashboard } from "./TradeSmsDashboard";

export type TradeSmsConnection = {
  provider: "twilio" | "clicksend";
  number: string; accountLabel: string; accountType: string; dailyLimit: number; usedSegments: number;
  status: "connecting" | "connected";
};

export function TradeSmsConnectionPanel({ user }: { user: User }) {
  return <TradeSmsDashboard user={user} />;
}
