import { LOCALE_ORDER, LOCALES } from "./locales/index.js";

export const LANGUAGE_ORDER = LOCALE_ORDER;
export const LANGUAGE_DEFINITIONS = Object.fromEntries(
  LOCALES.map((locale) => [locale.code, toLanguage(locale)])
);
export const LANGUAGES = LANGUAGE_ORDER.map((code) => LANGUAGE_DEFINITIONS[code]);

const LANGUAGE_ALIASES = new Map(
  LANGUAGES.flatMap((language) => languageAliases(language).map((alias) => [alias, language.code]))
);
const VOICE_LANGUAGE_NAME_RE = new RegExp(
  `\\s+\\((?:${LANGUAGES.map((language) => language.names.en).filter(Boolean).map(escapeRegExp).join("|")})\\b.*\\)$`,
  "i"
);

export function getLanguage(code) {
  if (LANGUAGE_DEFINITIONS[code]) return LANGUAGE_DEFINITIONS[code];
  const tag = canonicalLanguageTag(code) || "und";
  return { code: tag, tts: tag, short: tag.split("-")[0].toUpperCase(),
    names: Object.fromEntries(LOCALE_ORDER.map(ui => [ui, displayLanguageName(tag, ui)])), aliases: [] };
}

export function getLanguageLabel(code, uiLanguage = "en") {
  const language = getLanguage(code);
  return language.names[uiLanguage] || language.names.en || language.code;
}

export function normalizeDocumentLanguage(value) {
  const normalized = normalizeAlias(value);
  if (/^(mix|mixed|na|n\/a|same|target)$/.test(normalized)) return "target";
  return LANGUAGE_ALIASES.get(normalized) || canonicalLanguageTag(value);
}

export function canonicalLanguageTag(value) {
  try {
    const tag = Intl.getCanonicalLocales(String(value || "").trim().replace(/_/g, "-"))[0] || "";
    return ["und", "zxx", "mul"].includes(tag) ? "" : tag;
  } catch { return ""; }
}

export function isValidUiLanguage(code) {
  return LOCALE_ORDER.includes(code);
}

export function getSpeechLanguages(voices = [], retained = []) {
  const codes = new Set(LANGUAGE_ORDER);
  for (const code of [...voices.map(voice => voice.lang), ...retained]) {
    const normalized = normalizeDocumentLanguage(code);
    if (normalized && normalized !== "target") codes.add(normalized);
  }
  return [...codes].map(getLanguage);
}

export function voiceMatchesLanguage(voice, language) {
  const requested = canonicalLanguageTag(language);
  const available = canonicalLanguageTag(voice?.lang);
  if (!requested || !available) return false;
  const target = new Intl.Locale(requested);
  const candidate = new Intl.Locale(available);
  const groupedNorwegian = target.language === "no" && ["nb", "nn"].includes(candidate.language);
  if (target.language !== candidate.language && !groupedNorwegian) return false;
  if (!target.script && !target.region) return true;
  const expandedTarget = target.maximize();
  const expandedVoice = candidate.maximize();
  return expandedTarget.script === expandedVoice.script
    && (!target.region || expandedTarget.region === expandedVoice.region);
}

export function splitGraphemes(text, language) {
  if (typeof Intl.Segmenter !== "function") return Array.from(String(text || ""));
  return [...new Intl.Segmenter(canonicalLanguageTag(language) || undefined, { granularity: "grapheme" })
    .segment(String(text || ""))].map(part => part.segment);
}

function displayLanguageName(tag, ui) {
  try { return new Intl.DisplayNames([ui], { type: "language" }).of(tag) || tag; }
  catch { return tag; }
}

export function speechLangFor(language) {
  return canonicalLanguageTag(language) || getLanguage(language).tts;
}

export function htmlLangFor(language) {
  return getLanguage(language).tts;
}

export function isValidLanguageCode(code) {
  return Boolean(canonicalLanguageTag(code));
}

export function getVoiceBaseName(name) {
  return String(name || "").replace(VOICE_LANGUAGE_NAME_RE, "");
}

export function filterSpeechText(text, languageCode) {
  const source = String(text || "");
  const characters = getLanguage(languageCode).speechCharacters || {};
  const allowedSource = `${characters.language || ""}${characters.common || ""}`;
  if (!allowedSource) return source.trim();
  const allowedCharacter = new RegExp(`[${allowedSource}\\s]`, "u");
  return Array.from(source)
    .map((character) => allowedCharacter.test(character) ? character : " ")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function toLanguage(locale) {
  return {
    code: locale.code,
    short: locale.short,
    tts: locale.tts,
    names: locale.names,
    aliases: locale.aliases || [],
    speechCharacters: locale.speechCharacters || {}
  };
}

function languageAliases(language) {
  return [
    language.code,
    language.short,
    language.tts,
    ...Object.values(language.names || {}),
    ...(language.aliases || [])
  ].map(normalizeAlias).filter(Boolean);
}

function normalizeAlias(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
