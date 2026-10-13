import { canonicalLanguageTag, getSpeechLanguages, getLanguage, getLanguageLabel, LANGUAGE_ORDER } from "./languages.js";

export function languageKind(code) {
  const base = canonicalLanguageTag(code).split("-")[0];
  return ["nb", "nn"].includes(base) ? "no" : base;
}

export function defaultLanguagePreferences() {
  return { mode: "custom", codes: [...LANGUAGE_ORDER] };
}

export function normalizeLanguagePreferences(value) {
  if (!value || !["all", "custom"].includes(value.mode) || !Array.isArray(value.codes)) return defaultLanguagePreferences();
  return { mode: value.mode, codes: [...new Set(value.codes.map(languageKind).filter(Boolean))] };
}

export function finalizeLanguagePreferences(value) {
  const preference = normalizeLanguagePreferences(value);
  return preference.mode === "custom" && !preference.codes.length ? { mode: "custom", codes: ["en"] } : preference;
}

export function normalizeLanguageSearch(value) {
  return String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, "");
}

const SEARCH_ALIASES = { en: ["英文"], zh: ["中文", "汉语", "漢語"], de: ["德文"], ja: ["日文"] };

export function languageSearchMatch(code, query) {
  const language = getLanguage(code), normalized = normalizeLanguageSearch(query);
  const names = [code, ...Object.values(language.names), ...(language.aliases || []), ...(SEARCH_ALIASES[code] || [])]
    .map(normalizeLanguageSearch);
  return { match: names.some(name => name.includes(normalized)),
    score: !normalized || names.includes(normalized) ? 0 : names.some(name => name.startsWith(normalized)) ? 1 : 2 };
}

export function createLanguagePreferences({ getVoices, getRetained, getPreference }) {
  function catalog(extra = []) {
    const codes = new Set(getSpeechLanguages(getVoices(), [...getRetained(), ...extra,
      ...normalizeLanguagePreferences(getPreference()).codes]).map(language => languageKind(language.code)).filter(Boolean));
    return [...codes].map(getLanguage).sort((a, b) => getLanguageLabel(a.code).localeCompare(getLanguageLabel(b.code)));
  }
  function codesFor(value = getPreference(), available = catalog()) {
    const preference = normalizeLanguagePreferences(value);
    return preference.mode === "all" ? available.map(language => language.code) : preference.codes;
  }
  function options() {
    const codes = codesFor(), entries = codes.map(code => ({ ...getLanguage(code), currentDocument: false }));
    for (const code of [...new Set(getRetained().map(canonicalLanguageTag).filter(Boolean))]) {
      if (!codes.includes(code)) entries.push({ ...getLanguage(code), currentDocument: true });
    }
    return entries;
  }
  return { catalog, codesFor, options };
}
