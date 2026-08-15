"use client";

import { useCallback, useState } from "react";
import { CreditexAllProgramCalculator } from "./CreditexAllProgramCalculator";
import { tradeRebatePreparingMessage } from "./trade-rebate-calculator-state";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type ApiResult = Record<string, unknown> & {
  ok?: boolean;
  code?: string;
  error?: string;
};

const PUBLIC_CALCULATOR_RECOVERY_TIMEOUT_MS = 60_000;
const PUBLIC_CALCULATOR_MAXIMUM_ATTEMPTS = 20;

export function PublicRebateCalculatorWorkspace() {
  const [preparingMessage, setPreparingMessage] = useState("");

  const api = useCallback(async (
    path: string,
    init: RequestInit = {},
    options: { requestTimeoutMs?: number } = {},
  ) => {
    const recoveryDeadline = Date.now() + PUBLIC_CALCULATOR_RECOVERY_TIMEOUT_MS;
    try {
      const headers = new Headers(init.headers);
      if (
        init.body
        && !(init.body instanceof FormData)
        && !headers.has("Content-Type")
      ) {
        headers.set("Content-Type", "application/json");
      }
      for (
        let attempt = 0;
        attempt < PUBLIC_CALCULATOR_MAXIMUM_ATTEMPTS;
        attempt += 1
      ) {
        const remaining = recoveryDeadline - Date.now();
        if (remaining <= 0) break;
        const controller = new AbortController();
        const timeout = window.setTimeout(
          () => controller.abort(),
          Math.min(options.requestTimeoutMs || 25_000, remaining),
        );
        let response: Response;
        try {
          response = await fetch(path, {
            ...init,
            headers,
            cache: "no-store",
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error(
              "The rebate calculator took too long to respond. Try again.",
            );
          }
          throw error;
        } finally {
          window.clearTimeout(timeout);
        }
        const result = await response.json().catch(() => ({})) as ApiResult;
        if (
          response.status === 503
          && (
            result.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"
            || result.code === "OFFICIAL_PRODUCT_FLEET_BUSY"
          )
          && attempt < PUBLIC_CALCULATOR_MAXIMUM_ATTEMPTS - 1
        ) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const requestedDelay = Number.isFinite(retryAfter)
            ? Math.min(Math.max(retryAfter * 1_000, 1_000), 5_000)
            : 1_000;
          const delay = Math.min(
            requestedDelay,
            Math.max(recoveryDeadline - Date.now(), 0),
          );
          if (delay <= 0) break;
          setPreparingMessage(tradeRebatePreparingMessage(attempt + 1));
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          continue;
        }
        if (!response.ok || result.ok === false) {
          throw new Error(
            result.error || "The rebate calculation could not be completed.",
          );
        }
        return result;
      }
      throw new Error("The rebate calculator could not be prepared.");
    } finally {
      setPreparingMessage(tradeRebatePreparingMessage(null));
    }
  }, []);

  return (
    <section
      className="dashboard-panel public-rebate-calculator"
      aria-labelledby="public-rebate-calculator-title"
    >
      <header className="dashboard-panel-heading">
        <span>REBATE CALCULATOR</span>
        <h1 id="public-rebate-calculator-title">
          See the calculated rebate value before you request a quote
        </h1>
        <p>
          Choose the work and approved product. The result is an exact,
          source-verified calculation for your selected inputs, installation
          date and source version. Certificate creation, eligibility and
          provider acceptance are separate. No account is needed.
        </p>
      </header>
      {preparingMessage && (
        <p className="trade-rebate-calculator-status" role="status">
          {preparingMessage}
        </p>
      )}
      <div className={styles.tradeCalculatorSurface}>
        <CreditexAllProgramCalculator api={api} role="public" />
      </div>
    </section>
  );
}
