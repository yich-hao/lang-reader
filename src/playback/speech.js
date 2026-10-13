import { getVoiceBaseName, normalizeDocumentLanguage, voiceMatchesLanguage } from "../i18n/languages.js";
import { createSpeechProgress } from "./speechProgress.js";
import { createSpeechTiming } from "./speechTiming.js";
import { createSpeechStartup } from "./speechStartup.js";
import { GOOGLE_RATE_MODEL, isGoogleNetworkVoice, speechRateForVoice } from "./speechRate.js";

export function createSpeech({ timingModel, startupModel, now = () => performance.now() } = {}) {
  let storage = null;
  try { storage = window.localStorage; } catch { /* Storage is optional. */ }
  timingModel ||= createSpeechTiming({ storage });
  startupModel ||= createSpeechStartup({ storage });
  const synth = window.speechSynthesis;
  let voices = [];
  let selectedVoiceName = "";
  let selectedVoiceNamesByLanguage = {};
  let activeSpeech = null;

  function loadVoices() {
    voices = synth ? synth.getVoices() : [];
    return voices;
  }

  function getVoices() {
    return voices.length ? voices : loadVoices();
  }

  function setVoice(name) {
    selectedVoiceName = name || "";
  }

  function setVoicesByLanguage(value) {
    selectedVoiceNamesByLanguage = value && typeof value === "object" ? { ...value } : {};
  }

  function getSelectedVoice(lang = "de-DE") {
    const available = getVoices();
    const language = normalizeDocumentLanguage(lang);
    const languageVoiceName = selectedVoiceNamesByLanguage[language] || selectedVoiceName;
    const matching = available.filter(voice => voiceMatchesLanguage(voice, lang));
    return matching.find(voice => getVoiceBaseName(voice.name) === languageVoiceName || voice.name === languageVoiceName)
      || matching.find(voice => voice.lang.toLowerCase() === lang.toLowerCase())
      || matching.find(voice => voice.default) || matching[0] || null;
  }

  function speak(text, options = {}) {
    const requestedAt = now();
    if (!synth || !text) return Promise.resolve();
    cancelActiveSpeech("Speech replaced");
    if (synth.paused) synth.resume();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || "de-DE";
    const requestedRate = Number(options.rate || 1);
    utterance.pitch = 1;
    utterance.volume = Number(options.volume ?? 1);
    const voice = getSelectedVoice(utterance.lang);
    if (!voice && getVoices().length) return Promise.reject(new Error(`No voice available for ${utterance.lang}`));
    if (voice) utterance.voice = voice;
    utterance.rate = speechRateForVoice(requestedRate, voice, utterance.lang);
    const timingOptions = { voice, lang: utterance.lang, rate: requestedRate,
      ...(isGoogleNetworkVoice(voice) ? { rateModel: GOOGLE_RATE_MODEL, engineRate: utterance.rate } : {}) };
    const estimate = timingModel.estimate(text, timingOptions);

    return new Promise((resolve, reject) => {
      const session = {
        utterance,
        resolve,
        reject,
        timeoutId: 0,
        timeoutMs: getSpeechTimeout(text, utterance.rate),
        settled: false,
        progress: null,
        timingOptions, estimate, started: false, activeAt: null, elapsedMs: 0, boundaries: 0,
        requestedAt, startupMs: null,
        startupValid: !synth.paused && !synth.pending && !synth.speaking
          && (!window.document || window.document.visibilityState === "visible"),
        onMeasurement: options.onMeasurement
      };
      activeSpeech = session;
      session.onVisibilityChange = () => {
        if (!session.started && window.document.visibilityState !== "visible") session.startupValid = false;
      };
      window.document?.addEventListener?.("visibilitychange", session.onVisibilityChange);

      if (typeof options.onProgress === "function") {
        session.progress = createSpeechProgress({
          text, rate: requestedRate, estimatedMs: estimate.estimatedMs, granularity: options.progressGranularity,
          now,
          onProgress: value => {
            if (activeSpeech === session && !session.settled) options.onProgress(value);
          }
        });
      }
      utterance.onstart = () => {
        if (activeSpeech !== session || session.settled || session.started) return;
        session.started = true;
        session.activeAt = now();
        session.startupMs = session.activeAt - session.requestedAt;
        if (synth.paused || (window.document && window.document.visibilityState !== "visible")) session.startupValid = false;
        session.progress?.start();
      };
      utterance.onpause = () => pauseSession(session);
      utterance.onresume = () => resumeSession(session);
      if (session.progress || typeof options.onBoundary === "function" || session.onMeasurement) utterance.onboundary = event => {
        if (activeSpeech !== session || session.settled || synth.paused) return;
        session.boundaries++;
        session.progress?.boundary(event.charIndex);
        if (Number.isInteger(event.charIndex) && event.charIndex >= 0 && event.charIndex < text.length) {
          options.onBoundary?.(event.charIndex);
        }
      };

      utterance.onend = () => {
        settleSpeech(session);
      };
      utterance.onerror = (event) => {
        settleSpeech(session, event.error || event);
      };
      scheduleSpeechTimeout(session);
      synth.speak(utterance);
    });
  }

  function stop() {
    cancelActiveSpeech("Speech stopped");
  }

  function pause() {
    if (!synth) return;
    if (activeSpeech) pauseSession(activeSpeech);
    if (activeSpeech?.timeoutId) {
      clearTimeout(activeSpeech.timeoutId);
      activeSpeech.timeoutId = 0;
    }
    synth.pause();
  }

  function resume() {
    if (!synth) return;
    synth.resume();
    if (activeSpeech) resumeSession(activeSpeech);
    if (activeSpeech && !activeSpeech.settled) scheduleSpeechTimeout(activeSpeech);
  }

  function pauseSession(session) {
    if (activeSpeech !== session || session.settled) return;
    if (!session.started) session.startupValid = false;
    if (session.activeAt !== null) session.elapsedMs += now() - session.activeAt;
    session.activeAt = null;
    session.progress?.pause();
  }

  function resumeSession(session) {
    if (activeSpeech !== session || session.settled) return;
    if (session.started && session.activeAt === null) session.activeAt = now();
    session.progress?.resume();
  }

  function scheduleSpeechTimeout(session) {
    if (!session || session.settled || activeSpeech !== session) return;
    if (session.timeoutId) clearTimeout(session.timeoutId);
    session.timeoutId = setTimeout(() => {
      if (activeSpeech !== session || session.settled) return;
      window.console.warn("Speech Synthesis hung. Timeout triggered.");
      settleSpeech(session, new Error("Timeout"));
      synth.cancel();
    }, session.timeoutMs);
  }

  function settleSpeech(session, error = null) {
    if (!session || session.settled) return;
    const actualMs = session.elapsedMs + (session.activeAt === null ? 0 : now() - session.activeAt);
    if (!error && session.started) timingModel.observe(session.utterance.text, session.timingOptions, actualMs);
    if (!error && session.started && session.startupValid) startupModel.observe(session.timingOptions, session.startupMs);
    if (error) session.progress?.stop();
    else session.progress?.finish();
    session.settled = true;
    window.document?.removeEventListener?.("visibilitychange", session.onVisibilityChange);
    if (session.timeoutId) clearTimeout(session.timeoutId);
    session.utterance.onend = null;
    session.utterance.onerror = null;
    session.utterance.onstart = null;
    session.utterance.onboundary = null;
    session.utterance.onpause = null;
    session.utterance.onresume = null;
    if (activeSpeech === session) activeSpeech = null;
    try {
      session.onMeasurement?.({ ...session.estimate, actualMs, startupMs: session.startupMs,
        startupSampleValid: !error && session.started && session.startupValid, boundaries: session.boundaries,
        voice: session.utterance.voice?.name || "default", lang: session.utterance.lang,
        rate: session.timingOptions.rate, engineRate: session.utterance.rate,
        rateModel: session.timingOptions.rateModel || "native", completed: !error && session.started, error: error ? String(error) : null });
    } catch (diagnosticError) { window.console.warn("Speech timing observer failed", diagnosticError); }
    if (error) session.reject(error);
    else session.resolve();
  }

  function cancelActiveSpeech(reason) {
    const session = activeSpeech;
    if (session) settleSpeech(session, new Error(reason));
    if (synth) synth.cancel();
  }

  function getSpeechTimeout(text, rate) {
    const normalizedRate = Math.max(0.5, Number(rate) || 1);
    const estimatedMs = String(text).length * 650 / normalizedRate;
    return Math.min(180000, Math.max(30000, Math.ceil(estimatedMs)));
  }

  function getStartupDelay({ lang = "de-DE", rate = 1 } = {}) {
    const voice = getSelectedVoice(lang);
    const requestedRate = Number(rate || 1);
    return startupModel.estimate({ voice, lang, rate: requestedRate,
      ...(isGoogleNetworkVoice(voice) ? { rateModel: GOOGLE_RATE_MODEL,
        engineRate: speechRateForVoice(requestedRate, voice, lang) } : {}) });
  }

  if (synth) {
    loadVoices();
    synth.onvoiceschanged = loadVoices;
  }

  return { getVoices, loadVoices, setVoice, setVoicesByLanguage, getSelectedVoice, getStartupDelay, speak, stop, pause, resume };
}
