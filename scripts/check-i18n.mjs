#!/usr/bin/env node
/**
 * CCJ i18n Key Consistency Check
 * Fails CI if any locale is missing a key that exists in en.json.
 * Run: node scripts/check-i18n.mjs
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "../packages/i18n/locales");

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_meta") continue;
    const full = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
const locales = {};

for (const file of files) {
  const locale = file.replace(".json", "");
  const data = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8"));
  locales[locale] = flattenKeys(data);
}

const baseLocale = "en";
const baseKeys = new Set(locales[baseLocale] ?? []);
let hasErrors = false;

for (const [locale, keys] of Object.entries(locales)) {
  if (locale === baseLocale) continue;
  const localeKeySet = new Set(keys);

  // Keys in en but missing in this locale
  const missing = [...baseKeys].filter((k) => !localeKeySet.has(k));
  // Keys in this locale but not in en (possible extras)
  const extra = keys.filter((k) => !baseKeys.has(k));

  if (missing.length > 0) {
    console.error(`\n❌ [${locale}] Missing ${missing.length} keys:`);
    for (const k of missing.slice(0, 20)) console.error(`   - ${k}`);
    if (missing.length > 20) console.error(`   ... and ${missing.length - 20} more`);
    hasErrors = true;
  }

  if (extra.length > 0) {
    console.warn(`\n⚠️  [${locale}] ${extra.length} extra keys not in 'en':`);
    for (const k of extra.slice(0, 10)) console.warn(`   + ${k}`);
  }
}

if (!hasErrors) {
  console.log(`✅ i18n check passed — all ${Object.keys(locales).length} locales consistent.`);
  console.log(`   Base keys: ${baseKeys.size} (from '${baseLocale}')`);
  process.exit(0);
} else {
  console.error(`\n❌ i18n check failed. Fix missing keys before merging.`);
  process.exit(1);
}
