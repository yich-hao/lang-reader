const STORAGE_KEY = "lang-reader.speech-startup.v1";
const MAX_PROFILES = 128;
const MAX_SAMPLES = 10;
const MAX_DELAY_MS = 10000;

function profileKey({ voice, lang = "en", rate = 1, rateModel = "native", engineRate = rate }) {
  return JSON.stringify([voice?.voiceURI || "", voice?.name || "default", voice?.localService ?? null,
    String(lang).toLowerCase(), Math.round(Number(rate) * 100) / 100, rateModel, engineRate]);
}

export function createSpeechStartup({ storage = null, now = () => Date.now() } = {}) {
  let profiles = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (saved?.version === 1 && Array.isArray(saved.profiles)) {
      for (const entry of saved.profiles.slice(-MAX_PROFILES)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, profile] = entry;
        if (typeof key !== "string" || !profile || !Number.isFinite(profile.updatedAt)
          || !Array.isArray(profile.samples)) continue;
        const samples = profile.samples.filter(value => Number.isFinite(value) && value >= 0 && value <= MAX_DELAY_MS)
          .slice(-MAX_SAMPLES);
        if (samples.length) profiles.set(key, { samples, updatedAt: profile.updatedAt });
      }
    }
  } catch { /* Storage is optional. */ }

  function estimate(options = {}) {
    const samples = profiles.get(profileKey(options))?.samples || [];
    return samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
  }

  function observe(options, delayMs) {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) return false;
    const key = profileKey(options);
    const samples = [...(profiles.get(key)?.samples || []), delayMs].slice(-MAX_SAMPLES);
    profiles.delete(key);
    profiles.set(key, { samples, updatedAt: now() });
    if (profiles.size > MAX_PROFILES) profiles.delete(profiles.keys().next().value);
    try { storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, profiles: [...profiles] })); }
    catch { /* Retain the in-memory average. */ }
    return true;
  }

  return { estimate, observe };
}
