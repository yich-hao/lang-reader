import { splitSentences, splitWordTokens } from "../parsing/textSegmentation.js";
import { DEFAULT_GAP_SECONDS } from "./playbackGap.js";

export function createPlaylist(items = [], options = {}) {
  return {
    items,
    mode: options.mode || "word",
    repeat: Number(options.repeat || 1),
    gapMs: Number(options.gapMs ?? DEFAULT_GAP_SECONDS * 1000),
    partGapMs: Number(options.partGapMs ?? options.gapMs ?? DEFAULT_GAP_SECONDS * 1000),
    itemIndex: 0,
    unitIndex: 0,
    repeatIndex: 0
  };
}

export function getCurrentUnit(state) {
  const item = state.items[state.itemIndex];
  if (!item) return null;
  const units = getUnits(item, state.mode);
  const unit = units[state.unitIndex];
  if (!unit) return null;
  return {
    item,
    text: typeof unit === "string" ? unit : unit.text,
    language: typeof unit === "string" ? undefined : unit.language,
    partIndex: typeof unit === "string" ? undefined : unit.partIndex,
    itemIndex: state.itemIndex,
    unitIndex: state.unitIndex
  };
}

export function moveNext(state) {
  const currentItem = state.items[state.itemIndex];
  if (!currentItem) return false;
  const units = getUnits(currentItem, state.mode);

  if (state.repeatIndex + 1 < state.repeat) {
    state.repeatIndex += 1;
    return true;
  }

  state.repeatIndex = 0;
  if (state.unitIndex + 1 < units.length) {
    state.unitIndex += 1;
    return true;
  }

  if (state.itemIndex + 1 < state.items.length) {
    state.itemIndex += 1;
    state.unitIndex = 0;
    return true;
  }

  return false;
}

export function movePrevious(state) {
  if (state.unitIndex > 0) {
    state.unitIndex -= 1;
    state.repeatIndex = 0;
    return state;
  }

  if (state.itemIndex > 0) {
    state.itemIndex -= 1;
    state.unitIndex = Math.max(0, getUnits(state.items[state.itemIndex], state.mode).length - 1);
  }
  state.repeatIndex = 0;
  return state;
}

export function setPosition(state, itemIndex, unitIndex = 0) {
  state.itemIndex = clamp(itemIndex, 0, Math.max(0, state.items.length - 1));
  state.unitIndex = Math.max(0, unitIndex);
  state.repeatIndex = 0;
  return state;
}

function getUnits(item, mode) {
  const parts = item.playableParts?.length ? item.playableParts : item.parts.filter((part) => part.role !== "mute" && part.role !== "hide" && part.role !== "translationMute");
  if (mode === "word") {
    const units = parts.flatMap((part) => splitWords(part.text, part.language).map((word) => ({ text: word, language: part.language, partIndex: part.index })));
    return units.length ? units : [{ text: item.targetText, language: parts[0]?.language }];
  }
  if (mode === "sentence") {
    return parts.flatMap((part) => splitSentences(part.text).map((sentence) => ({ text: sentence, language: part.language, partIndex: part.index })));
  }
  return parts.map((part) => ({ text: part.text, language: part.language, partIndex: part.index }));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function splitWords(text, language) {
  if (/^zh(-|$)/i.test(language)) return [...String(text).replace(/\s+/g, "")].filter(Boolean);
  if (/^(ja|th|lo|km|my)(-|$)/i.test(language)) return splitWordTokens(text, language).filter(token => token.clickable).map(token => token.text);
  return String(text)
    .split(/[\s,;:!?()"'„“”]+/)
    .map((word) => word.trim())
    .filter((word) => /\p{L}/u.test(word));
}
