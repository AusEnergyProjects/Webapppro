# TLink address maps

Customer and job maps use MapTiler SDK sessions for the background map. Location matching uses TLink's own copy of the open Australian G-NAF address directory in the `EVIDENCE` R2 binding. Customer names, addresses and job details are not submitted to MapTiler. Google satellite and roof-design tools load only when explicitly opened.

MapTiler SDK 4.1.0 pins a MapLibre version affected by [GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579). TLink disables the SDK's HTML attribution renderer with `forceNoAttributionControl` and supplies fixed text/link/logo DOM attribution instead. Do not re-enable provider-supplied HTML attribution or introduce `Popup.setHTML` with untrusted content. The dependency advisory remains until the SDK adopts a patched compatible version.

## Saved locations

`trade_map_location_cache` stores coordinates, source release and source address ID by business owner and normalised CRM address. Staff and devices share the same rows. Server leases prevent overlapping views from processing the same address concurrently. The API accepts no browser-supplied coordinates. Matching is exact after controlled abbreviation and unit formatting normalisation; ambiguous matches remain unlocated.

G-NAF matches have no timed expiry. Changing a record's address produces a new cache key. Legacy Google coordinates remain identified as Google, are excluded from the new overview, and retain their existing expiry cleanup. They must never be relabelled as G-NAF.

Map responses contain at most 96 clusters and 50 sidebar records. Counts cover the complete authorised, filtered business dataset. Location processing uses batches of at most 200 and requires an explicit Start action. Closing or pausing the view stops new batches; completed matches remain saved, and an interrupted lease becomes available after two minutes.

## Build the national directory

Use the release URL and SHA-256 recorded in `scripts/build-gnaf-directory.mjs`. Download and extract outside the repository. Run Node with type stripping:

```text
node --experimental-strip-types scripts/build-gnaf-directory.mjs --source=<absolute extracted source> --output=<absolute new output directory> --version=<release version>
```

The builder joins current address records to their default geocodes and associated streets/localities. It preserves units, levels and number ranges; it does not multiply unrelated locality aliases onto every address. Completed states are checkpointed. For an interrupted build, rerun with the same inputs and `--resume=true`; mismatched source or normaliser identity is rejected. Preserve incomplete stages for inspection.

Postcode/hash partitions contain gzip JSON and SHA-256 metadata. The runtime limits compressed partitions to 2 MiB and actual decompressed content to 8 MiB. Source coordinates are GDA2020; the GDA2020/WGS84 web-map null transformation is adequate for approximate address pins, not survey or roof-measurement precision. G-NAF attribution and the Open G-NAF licence link appear in the map.

## Provision and activate

Configure `TLINK_MAPTILER_BROWSER_KEY` as a dedicated public browser key restricted to the production origins. Activate a commercial MapTiler plan and set its extra-spending limit before switching production. Do not substitute the Google browser key or a private service credential.

Directory maintenance requires all three runtime settings:

- `TLINK_GNAF_IMPORT_TOKEN`: random secret of at least 32 characters.
- `TLINK_GNAF_IMPORT_VERSION`: the exact manifest version.
- `TLINK_GNAF_IMPORT_UNTIL`: UTC expiry within the next 24 hours.

Apply the settings through a Sites deployment. Run `scripts/upload-gnaf-directory.mjs` with Node type stripping and a terminal; it requests hidden JSON stdin containing `origin`, `directory`, `token` and `version`. Never put the token in shell arguments or a file.

The uploader validates local hashes, sends at most sixteen partitions concurrently, uploads the manifest last, verifies every partition in bounded batches, then activates the release. Its non-secret local journal permits safe resume. Versioned objects are immutable. Activation cannot replace `address-directory/current.json` until all verification receipts match the manifest. Remove the three maintenance settings and apply that environment revision after provisioning.

Provider test fixtures and 100,000-record scale tests are synthetic and make no paid geocoding calls. Cloud storage, application database usage, map sessions and explicitly opened Google design tools still follow their respective hosting/provider plans.
