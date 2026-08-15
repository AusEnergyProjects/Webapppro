"use client";

import { useCallback, useState } from "react";
import type { User } from "firebase/auth";
import { firebaseAuth } from "@/lib/firebase-client";
import { requestWithCreditexTokenRecovery } from "@/lib/creditex-auth-token";
import { CreditexAllProgramCalculator } from "./CreditexAllProgramCalculator";
import { tradeRebatePreparingMessage } from "./trade-rebate-calculator-state";
import styles from "./CreditexVeuPilotWorkspace.module.css";

type ApiAttempt = {
  response: Response;
  result: Record<string, unknown> & {
    ok?: boolean;
    code?: string;
    error?: string;
  };
};

export function TradeRebateCalculatorWorkspace({ user }: { user: User }) {
  const [preparingMessage, setPreparingMessage] = useState("");

  const api = useCallback(async (
    path: string,
    init: RequestInit = {},
    options: { requestTimeoutMs?: number } = {},
  ) => {
    try {
      const requestTimeoutMs = Math.min(
        Math.max(options.requestTimeoutMs ?? 20_000, 1_000),
        300_000,
      );
      const activeUid = user.uid;
      const assertActiveIdentity = () => {
        if (firebaseAuth.currentUser?.uid !== activeUid) {
          throw new Error(
            "The signed-in account changed. Loading the new workspace.",
          );
        }
      };
      const headers = new Headers(init.headers);
      if (
        init.body
        && !(init.body instanceof FormData)
        && !headers.has("Content-Type")
      ) {
        headers.set("Content-Type", "application/json");
      }

      const { response, result } = await requestWithCreditexTokenRecovery<ApiAttempt>({
        user,
        currentUid: () => firebaseAuth.currentUser?.uid,
        isUnauthorized: (attempt) => attempt.response.status === 401,
        request: async (idToken) => {
          headers.set("Authorization", `Bearer ${idToken}`);
          for (let attempt = 0; attempt < 20; attempt += 1) {
            assertActiveIdentity();
            const controller = new AbortController();
            const timeout = window.setTimeout(
              () => controller.abort(),
              requestTimeoutMs,
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
                  `The rebate calculator did not respond within ${Math.ceil(
                    requestTimeoutMs / 1_000,
                  )} seconds. Try again.`,
                );
              }
              throw error;
            } finally {
              window.clearTimeout(timeout);
            }
            const result = await response.json().catch(() => ({})) as ApiAttempt["result"];
            assertActiveIdentity();
            if (
              response.status === 503
              && (
                result.code === "CREDITEX_SCHEMA_GUARDS_INSTALLING"
                || result.code === "OFFICIAL_PRODUCT_FLEET_BUSY"
              )
              && attempt < 19
            ) {
              const retryAfterSeconds = Number(response.headers.get("Retry-After"));
              const retryAfterMilliseconds = Number.isFinite(retryAfterSeconds)
                ? Math.min(Math.max(retryAfterSeconds * 1_000, 1_000), 5_000)
                : 1_000;
              setPreparingMessage(tradeRebatePreparingMessage(attempt + 1));
              await new Promise((resolve) => window.setTimeout(
                resolve,
                retryAfterMilliseconds,
              ));
              assertActiveIdentity();
              continue;
            }
            return { response, result };
          }
          throw new Error("The governed rebate calculator could not be prepared.");
        },
      });

      assertActiveIdentity();
      if (!response.ok || result.ok === false) {
        throw new Error(
          result.error || "The rebate calculation request could not be completed.",
        );
      }
      return result;
    } finally {
      setPreparingMessage(tradeRebatePreparingMessage(null));
    }
  }, [user]);

  return (
    <section className="dashboard-panel trade-rebate-calculator" aria-labelledby="trade-rebate-calculator-title">
      <header className="dashboard-panel-heading">
        <span>REBATE AND CERTIFICATE CALCULATIONS</span>
        <h2 id="trade-rebate-calculator-title">Calculate before you quote</h2>
        <p>
          Use the same source-pinned calculator as Creditex while preparing a
          customer quote or invoice. Successful governed results are exact for
          their selected inputs, date, approved product snapshot and formula/source
          version. They do not create or trade certificates and do not record
          provider acceptance.
        </p>
      </header>
      {preparingMessage && (
        <p className="trade-rebate-calculator-status" role="status">
          {preparingMessage}
        </p>
      )}
      <div className={styles.tradeCalculatorSurface}>
        <CreditexAllProgramCalculator
          api={api}
          role="trade"
          documentDraftOwnerUid={user.uid}
        />
      </div>
    </section>
  );
}
