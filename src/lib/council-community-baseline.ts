// Keep the snapshot lazy through a normal module import. The Sites bundler leaves
// dynamic JSON imports with attributes pointing at an unavailable source path.
import snapshot from "../data/council-community-baseline.json" with { type: "json" };

export default snapshot;
