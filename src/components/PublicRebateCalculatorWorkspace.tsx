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

export function PublicRebateCalculatorWorkspace() {
  const [preparingMessage, setPreparingMessage] = useState("");

  const api = useCallback(async (
    path: string,
    init: RequestInit = {},
    options: { requestTimeoutMs?: number } = {},
  ) => {
    try {
      const headers = new Headers(init.headers);
      if (
        init.body
        && !(init.body instanceof FormData)
        && !headers.has("Content-Type")
      ) {
        headers.set("Content-Type", "application/json");
      }
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const controller = new AbortController();
        const timeout = window.setTimeout(
          () => controller.abort(),
          options.requestTimeoutMs || 25_000,
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
          && result.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"
          && attempt < 9
        ) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          const delay = Number.isFinite(retryAfter)
            ? Math.min(Math.max(retryAfter * 1_000, 1_000), 5_000)
            : 1_000;
          setPreparingMessage(tradeRebatePreparingMessage(attempt + 1));
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          continue;
        }
        if (!response.ok || result.ok === false) {
          throw new Error(
            result.error || "The rebate estimate could not be completed.",
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
        <span>REBATE ESTIMATOR</span>
        <h1 id="public-rebate-calculator-title">
          See the rebate value before you request a quote
        </h1>
        <p>
          Choose the work and approved product. We use the official scheme
          data to calculate an estimate. No account is needed.
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
