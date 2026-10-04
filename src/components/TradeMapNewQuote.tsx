"use client";

import type { User } from "firebase/auth";
import { TradeQuickQuoteForm } from "./TradeQuickQuoteForm";

const defaults = {
  solar: { serviceCategory: "solar", description: "Solar installation" },
  area: { serviceCategory: "insulation", description: "Insulation roof area" },
  distance: { serviceCategory: "other", description: "Measured work" },
};

export function TradeMapNewQuote({ measurementKind, ...props }: {
  user: User;
  canCreateCustomer: boolean;
  onCreated: (workOrderId: string) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  measurementKind: keyof typeof defaults;
}) {
  const initial = defaults[measurementKind];
  return <TradeQuickQuoteForm {...props} initialServiceCategory={initial.serviceCategory} initialDescription={initial.description} mapQuantity />;
}
