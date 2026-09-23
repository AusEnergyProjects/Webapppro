/// <reference types="google.maps" />

import { interpretTradeMapGeocode, type TradeMapGeocodeResult } from "./trade-record-map";

declare global {
  interface Window {
    [key: `__tlinkGoogleMapsReady_${number}`]: (() => void) | undefined;
    gm_authFailure?: () => void;
  }
}

export class GoogleMapsClientError extends Error {
  readonly reason: "auth" | "network";

  constructor(reason: "auth" | "network") {
    super(reason === "auth" ? "Google Maps could not authorise this website." : "Google Maps could not be loaded.");
    this.name = "GoogleMapsClientError";
    this.reason = reason;
  }
}

// The Google SDK is one shared browser resource; address caches belong to each map.
let sdkPromise: Promise<typeof google.maps> | null = null;
let authFailed = false;
let authHandlerInstalled = false;
let loaderAttempt = 0;
const authFailureListeners = new Set<() => void>();

export function onGoogleMapsAuthFailure(listener: () => void): () => void {
  authFailureListeners.add(listener);
  return () => { authFailureListeners.delete(listener); };
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (authFailed) return Promise.reject(new GoogleMapsClientError("auth"));
  if (sdkPromise) return sdkPromise;
  if (!authHandlerInstalled) {
    const previous = window.gm_authFailure;
    window.gm_authFailure = () => {
      authFailed = true;
      for (const listener of authFailureListeners) listener();
      previous?.();
    };
    authHandlerInstalled = true;
  }
  const scriptReady = new Promise<void>((resolve, reject) => {
    if (typeof google !== "undefined" && typeof google.maps?.importLibrary === "function") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    const callbackName: `__tlinkGoogleMapsReady_${number}` = `__tlinkGoogleMapsReady_${++loaderAttempt}`;
    let settled = false;
    const finish = (error?: GoogleMapsClientError) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      script.onerror = null;
      if (error) {
        // A late script can only invoke its own no-op, never a newer attempt's callback.
        window[callbackName] = () => { delete window[callbackName]; };
        script.remove();
        reject(error);
      } else {
        delete window[callbackName];
        resolve();
      }
    };
    const unsubscribe = onGoogleMapsAuthFailure(() => finish(new GoogleMapsClientError("auth")));
    const timeout = window.setTimeout(() => finish(new GoogleMapsClientError("network")), 20_000);
    window[callbackName] = () => finish();
    const params = new URLSearchParams({
      key: apiKey,
      loading: "async",
      callback: callbackName,
      v: "weekly",
      language: "en",
      region: "AU",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    script.onerror = () => finish(new GoogleMapsClientError("network"));
    document.head.append(script);
  });
  sdkPromise = scriptReady.then(async () => {
    await Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("marker"),
      google.maps.importLibrary("geocoding"),
    ]);
    if (authFailed) throw new GoogleMapsClientError("auth");
    return google.maps;
  }).catch((error: unknown) => {
    sdkPromise = null;
    throw error instanceof GoogleMapsClientError ? error : new GoogleMapsClientError("network");
  });
  return sdkPromise;
}

/** No record identifiers, names, notes or contacts are included in the Google request. */
export function geocodeTradeMapAddress(geocoder: google.maps.Geocoder, address: string): Promise<TradeMapGeocodeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: TradeMapGeocodeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish({ status: "error", reason: "unavailable" }), 15_000);
    try {
      void geocoder.geocode({ address, componentRestrictions: { country: "AU" }, region: "AU" }, (results, status) => {
        finish(interpretTradeMapGeocode(status, results));
      }).catch(() => finish({ status: "error", reason: "unavailable" }));
    } catch {
      finish({ status: "error", reason: "unavailable" });
    }
  });
}
