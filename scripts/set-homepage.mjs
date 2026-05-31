#!/usr/bin/env node
/**
 * Switch which homepage shows at /
 *
 *   node scripts/set-homepage.mjs alt      → HomePageAlt at /
 *   node scripts/set-homepage.mjs classic  → HomePage at /
 *
 * Restart npm run dev after running.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const mode = (process.argv[2] || "alt").toLowerCase();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(root, "src", "App.jsx");

const ALT_AT_ROOT = `          <Route path="/" element={<HomePageAlt />} />
          <Route path="/home-classic" element={<HomePage />} />`;

const CLASSIC_AT_ROOT = `          <Route path="/" element={<HomePage />} />
          <Route path="/home-alt" element={<HomePageAlt />} />`;

let text = readFileSync(appPath, "utf8");

if (mode === "alt" || mode === "new") {
  if (!text.includes('element={<HomePageAlt />}')) {
    console.error("Could not find homepage routes in App.jsx — edit manually.");
    process.exit(1);
  }
  text = text.replace(
    /          <Route path="\/" element=\{<HomePage(?:Alt)? \/>\} \/>\s*\n          <Route path="\/home-(?:classic|alt)" element=\{<HomePage(?:Alt)? \/>\} \/>/,
    ALT_AT_ROOT,
  );
  writeFileSync(appPath, text);
  console.log("Done: / uses HomePageAlt (new style). Classic at /home-classic");
} else if (mode === "classic" || mode === "old") {
  text = text.replace(
    /          <Route path="\/" element=\{<HomePage(?:Alt)? \/>\} \/>\s*\n          <Route path="\/home-(?:classic|alt)" element=\{<HomePage(?:Alt)? \/>\} \/>/,
    CLASSIC_AT_ROOT,
  );
  writeFileSync(appPath, text);
  console.log("Done: / uses HomePage (classic). Alt at /home-alt");
} else {
  console.log("Usage: node scripts/set-homepage.mjs alt|classic");
  process.exit(1);
}

console.log("Restart: npm run dev");
