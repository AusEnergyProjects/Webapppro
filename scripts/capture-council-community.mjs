import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fetchCommunitySnapshot } from "../src/lib/council-community-server.ts";

// Reproducible capture of the six public, allowlisted CER files. No accounts or private records are read.
const snapshot = await fetchCommunitySnapshot();
const target = new URL("../src/data/council-community-baseline.json", import.meta.url);
await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
await writeFile(target, JSON.stringify(snapshot) + "\n", "utf8");
console.log(JSON.stringify({ path: fileURLToPath(target), sourceAsOf: snapshot.sourceAsOf, fetchedAt: snapshot.fetchedAt,
  datasets: snapshot.datasets.map(item => ({ metric: item.id, postcodes: item.rows.length, months: item.months.length, sha256: item.sha256 })) }, null, 2));
