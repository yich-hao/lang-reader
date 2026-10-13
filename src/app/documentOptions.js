import { normalizeDocumentLanguage } from "../i18n/languages.js";
import { REPEAT_INFINITY_VALUE } from "../core/config.js";
import { GAP_SECONDS, normalizeGapSeconds } from "../playback/playbackGap.js";

export function stripFrontMatterComment(value) {
  return String(value || "").replace(/\s+#.*$/, "");
}

export function parseDocumentOptions(text) {
  const match = String(text || "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return {};
  const options = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^\s*([A-Za-z_-]+)\s*:\s*(.*?)\s*$/);
    if (!pair) continue;
    const key = pair[1].toLowerCase().replace(/[-_]/g, "");
    const value = stripFrontMatterComment(pair[2]).trim().replace(/^["']|["']$/g, "");
    const lower = value.toLowerCase();
    if (["mode", "type", "parse"].includes(key)) {
      if (/^(reader|markdown|md|note|paragraph)$/.test(lower)) options.mode = "paragraph";
      if (/^(vocab|vocabulary|words?|study)$/.test(lower)) options.mode = "vocabulary";
      if (lower === "study") options.workspace = "study";
    }
    if (["target", "targetlanguage", "lang"].includes(key)) {
      const language = normalizeDocumentLanguage(value);
      if (language) options.targetLanguage = language;
    }
    if (["translation", "translationlanguage", "translate"].includes(key)) {
      const language = normalizeDocumentLanguage(value);
      if (language) options.translationLanguage = language;
    }
    if (key === "clickmode" && ["word", "sentence", "paragraph", "cell"].includes(lower)) options.clickMode = lower;
    if (key === "playmode" && ["word", "sentence", "paragraph", "cell"].includes(lower)) options.playbackUnit = lower === "cell" ? "paragraph" : lower;
    if (key === "speech") {
      const platform = { a: "apple", g: "google", m: "microsoft" }[lower] || lower;
      if (["all", "apple", "google", "microsoft"].includes(platform)) options.speechSource = platform;
    }
    if (key === "loopcount") {
      const count = Number(value);
      if (["infinite", "infinity", "∞"].includes(lower)) options.repeat = REPEAT_INFINITY_VALUE;
      else if (value && Number.isInteger(count) && count >= 1 && count < REPEAT_INFINITY_VALUE) options.repeat = count;
    }
    if (key === "unitgap" && value && (GAP_SECONDS.includes(Number(value)) || [0.25, 0.75].includes(Number(value)))) {
      options.gap = normalizeGapSeconds(value);
    }
    if (key === "speed") {
      const number = Number(value);
      const min = 0.5;
      const max = 3;
      const step = 0.05;
      if (value && Number.isFinite(number) && number >= min && number <= max && Math.abs(number / step - Math.round(number / step)) < 1e-8) {
        options.rate = number;
      }
    }
  }
  return options;
}
