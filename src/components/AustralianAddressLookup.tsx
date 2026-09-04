"use client";

import {
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./AustralianAddressLookup.module.css";

export type AustralianAddressSuggestion = {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  addressState: string;
  postcode: string;
  provider?: string;
  providerReference?: string;
  formattedAddress?: string;
  selectionProof?: string;
};

type AustralianAddressPrediction = Pick<
  AustralianAddressSuggestion,
  "id" | "label"
> & { provider: string };

export function AustralianAddressLookup({
  value,
  onChange,
  onSelect,
  endpoint = "/api/address-suggestions",
  getAuthorization,
  label = "Street address",
  placeholder = "Start typing an Australian address",
  maxLength = 140,
  required = false,
  name,
  inputRef,
  className = "",
  inputClassName = "",
  describedBy,
  invalid = false,
  hideHelp = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (selection: AustralianAddressSuggestion) => void;
  endpoint?: string;
  getAuthorization?: () => Promise<string>;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  name?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  inputClassName?: string;
  describedBy?: string;
  invalid?: boolean;
  hideHelp?: boolean;
}) {
  const id = useId();
  const [predictions, setPredictions] = useState<AustralianAddressPrediction[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const suppressLookup = useRef(false);
  const sessionToken = useRef("");
  const predictionController = useRef<AbortController | null>(null);
  const resolveController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (suppressLookup.current) {
      suppressLookup.current = false;
      return;
    }
    resolveController.current?.abort();
    const query = value.trim();
    if (query.length < 3) {
      sessionToken.current = "";
      return;
    }
    let active = true;
    const controller = new AbortController();
    predictionController.current?.abort();
    predictionController.current = controller;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void (async () => {
        if (!sessionToken.current) sessionToken.current = globalThis.crypto.randomUUID();
        const requestSessionToken = sessionToken.current;
        const authorization = getAuthorization ? await getAuthorization() : "";
        const headers = new Headers({ "Content-Type": "application/json" });
        if (authorization) headers.set("Authorization", `Bearer ${authorization}`);
        const response = await fetch(endpoint, {
          method: "POST",
          body: JSON.stringify({
            action: "predict",
            query,
            sessionToken: requestSessionToken,
          }),
          cache: "no-store",
          headers,
          signal: controller.signal,
        });
        const result = await response.json() as {
          configured?: boolean;
          predictions?: AustralianAddressPrediction[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || "Address search failed.");
        if (!active || sessionToken.current !== requestSessionToken) return;
        setConfigured(Boolean(result.configured));
        setMessage("");
        setPredictions(result.predictions || []);
        setActiveIndex(0);
      })().catch((error) => {
        if (!active || controller.signal.aborted) return;
        setMessage(error instanceof Error
          ? error.message
          : "Address suggestions are temporarily unavailable. Enter the address manually.");
        sessionToken.current = "";
        setPredictions([]);
      }).finally(() => {
        if (predictionController.current === controller) {
          predictionController.current = null;
          if (active) setSearching(false);
        }
      });
    }, 280);
    return () => {
      active = false;
      controller.abort();
      if (predictionController.current === controller) {
        predictionController.current = null;
      }
      window.clearTimeout(timer);
    };
  }, [endpoint, getAuthorization, value]);

  useEffect(() => () => {
    predictionController.current?.abort();
    resolveController.current?.abort();
    sessionToken.current = "";
  }, []);

  async function choose(prediction: AustralianAddressPrediction) {
    if (resolving) return;
    const controller = new AbortController();
    resolveController.current?.abort();
    resolveController.current = controller;
    setPredictions([]);
    setResolving(true);
    setMessage("Resolving selected address.");
    if (!sessionToken.current) sessionToken.current = globalThis.crypto.randomUUID();
    const requestSessionToken = sessionToken.current;
    try {
      const authorization = getAuthorization ? await getAuthorization() : "";
      const headers = new Headers({ "Content-Type": "application/json" });
      if (authorization) headers.set("Authorization", `Bearer ${authorization}`);
      const response = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({
          action: "resolve",
          provider: prediction.provider,
          providerReference: prediction.id,
          query: value.trim(),
          sessionToken: requestSessionToken,
        }),
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      const result = await response.json() as {
        configured?: boolean;
        selection?: AustralianAddressSuggestion | null;
        error?: string;
      };
      if (!response.ok || !result.configured || !result.selection) {
        throw new Error(
          result.error || "This address could not be resolved. Enter the address manually.",
        );
      }
      suppressLookup.current = true;
      sessionToken.current = "";
      setConfigured(true);
      setMessage("Address selected.");
      onSelect(result.selection);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error
        ? error.message
        : "This address could not be resolved. Enter the address manually.");
    } finally {
      if (sessionToken.current === requestSessionToken) sessionToken.current = "";
      if (resolveController.current === controller) {
        resolveController.current = null;
        setResolving(false);
      }
    }
  }

  const showsGoogleAttribution = predictions.some(
    (prediction) => prediction.provider === "google-places"
      || prediction.provider === "google-geocoding",
  );

  return (
    <div className={`${styles.lookup} ${className}`.trim()}>
      <span id={`${id}-label`}>{label}</span>
      <span className={styles.control}>
        <input
          ref={inputRef}
          name={name}
          className={inputClassName}
          required={required}
          maxLength={maxLength}
          autoComplete="address-line1"
          value={value}
          placeholder={placeholder}
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-autocomplete="list"
          aria-expanded={predictions.length > 0}
          aria-controls={`${id}-options`}
          aria-activedescendant={predictions[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          aria-describedby={describedBy}
          aria-errormessage={invalid ? describedBy : undefined}
          aria-invalid={invalid}
          aria-busy={searching || resolving}
          onChange={(event) => {
            resolveController.current?.abort();
            resolveController.current = null;
            setResolving(false);
            onChange(event.target.value);
            setMessage("");
            if (event.target.value.trim().length < 3) {
              sessionToken.current = "";
              setPredictions([]);
            }
          }}
          onBlur={() => {
            predictionController.current?.abort();
            predictionController.current = null;
            setPredictions([]);
            setSearching(false);
            sessionToken.current = "";
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              predictionController.current?.abort();
              resolveController.current?.abort();
              predictionController.current = null;
              resolveController.current = null;
              sessionToken.current = "";
              setPredictions([]);
              setSearching(false);
              setResolving(false);
              return;
            }
            if (!predictions.length || resolving) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(current + 1, predictions.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              void choose(predictions[activeIndex]);
            }
          }}
        />
        {(searching || resolving) && (
          <span
            className={styles.spinner}
            aria-label={resolving ? "Resolving address" : "Searching addresses"}
          />
        )}
      </span>
      {predictions.length > 0 && (
        <span className={styles.options}>
          <span id={`${id}-options`} role="listbox" style={{ display: "contents" }}>
            {predictions.map((prediction, index) => (
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                id={`${id}-option-${index}`}
                key={`${prediction.provider}-${prediction.id}`}
                disabled={resolving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void choose(prediction)}
              >
                {prediction.label}
              </button>
            ))}
          </span>
          {showsGoogleAttribution && (
            <small className={styles.attribution}>
              <span translate="no">Google Maps</span>
            </small>
          )}
        </span>
      )}
      {(!hideHelp || message) && (
        <small className={styles.help} role="status" aria-live="polite">
          {message
            || (configured === false
              ? "Address lookup is unavailable. Enter the address manually."
              : "Choose a matching address to fill the suburb, state and postcode automatically.")}
        </small>
      )}
    </div>
  );
}
