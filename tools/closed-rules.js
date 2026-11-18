// Shared rules for keeping businesses that are no longer operating out of the directory.
// Used by the importers (import-osm-businesses, import-osm-near-home, import-salestax-storefronts,
// merge-candidates) and by clean-data.js.
//
//   isClosedChain(name)   - the name is a chain listed in data/closed-chains.txt
//   lifecycleClosed(tags) - OpenStreetMap tags say the place is disused, vacant or abandoned

const fs = require("fs");
const path = require("path");

const CHAINS_FILE = path.resolve(__dirname, "..", "data", "closed-chains.txt");
const wordsOf = (value) => String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

function loadClosedChains(file = CHAINS_FILE) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(wordsOf)
    .filter((words) => words.length);
}
const CLOSED_CHAINS = loadClosedChains();

// True when the name starts with a closed chain's name as whole words: "Rite Aid", "RITE AID #1234",
// "Rite Aid Pharmacy", "RiteAid". Not "Favorite Aid" or "Rite Aidan's".
function isClosedChain(name, chains = CLOSED_CHAINS) {
  const words = wordsOf(name);
  if (!words.length) return false;
  return chains.some((chain) => chain.every((word, index) => words[index] === word) || words[0] === chain.join(""));
}

// OpenStreetMap "lifecycle" tagging. A place is treated as no longer operating when:
//   - it says so outright: disused=yes, abandoned=yes, or its main tag is a marker such as
//     shop=vacant or amenity=disused; or
//   - its only business tag carries a lifecycle prefix (disused:shop=*, abandoned:amenity=*, was:shop=* ...)
//     and nothing has replaced it.
// A live business that merely remembers what used to be there (shop=supermarket + disused:name=Kmart,
// or shop=houseware + disused:shop=department_store) is kept.
const FEATURE_KEYS = ["shop", "amenity", "office", "craft", "tourism", "leisure", "healthcare"];
const PREFIXED_KEYS = new Set([...FEATURE_KEYS, "building", "industrial", "man_made", "landuse"]);
const LIFECYCLE_PREFIXES = new Set(["disused", "abandoned", "was", "closed", "former", "vacant", "razed", "demolished", "removed", "destroyed"]);
const CLOSED_VALUES = new Set(["vacant", "disused", "abandoned", "closed", "yes_closed", "no"]);

function lifecycleClosed(tags) {
  if (!tags) return false;
  if (["disused", "abandoned", "closed", "vacant"].some((key) => tags[key] === "yes")) return true;
  if (FEATURE_KEYS.some((key) => CLOSED_VALUES.has(tags[key]))) return true;
  if (FEATURE_KEYS.some((key) => tags[key])) return false;
  return Object.keys(tags).some((key) => {
    const at = key.indexOf(":");
    return at > 0 && LIFECYCLE_PREFIXES.has(key.slice(0, at)) && PREFIXED_KEYS.has(key.slice(at + 1));
  });
}

module.exports = { isClosedChain, lifecycleClosed, loadClosedChains };
