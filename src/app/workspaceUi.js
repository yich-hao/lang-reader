import { initSegmentedControls, initCustomSliders, repositionAllSegmentedControls as repositionAll } from "../ui/customControls.js";
import { createModal } from "../ui/modal.js";

export function createWorkspaceUi({ state, services, elements, document, window, renderFilesPanel, saveSettings, t, beginTemporaryWordMode, endTemporaryWordMode, stopPlayback, handlePlaybackButton, moveKeyboardSelection, setKeyboardClickMode, openCurrentTranslation, cycleRepeatValue, updateActiveTableState }) {
  const MOBILE_SETTINGS_QUERY = "(max-width: 767px)";
  const SETTINGS_SNAP_STATES = ["collapsed", "compact", "medium", "full"];
  const mobileSettingsMedia = window.matchMedia(MOBILE_SETTINGS_QUERY);
  let settingsSheetState = "compact";
  let settingsSheetDrag = null;
  let suppressSettingsToggleClick = false;
  const shortcutsModal = createModal({ overlay: elements.shortcutsModal,
    content: elements.shortcutsModal.querySelector(".modal-content"), closeButton: elements.closeShortcutsButton, document });
  let isThemeListenerRegistered = false;
  let finishThemeMotion = null;
  const themeModes = ["light", "dark", "auto"];
  const themeSystemQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const themeFullClip = "polygon(0 0,100% 0,100% 100%,0 100%,0 0)";
  const themeSunClip = "polygon(2.25px 0,100% 0,100% calc(100% - 2.25px),2.25px 0,2.25px 0)";
  const themeMoonClip = "polygon(0 2.25px,0 2.25px,calc(100% - 2.25px) 100%,calc(100% - 2.25px) 100%,0 100%)";
  const themeSunFull = "scale(.88)";
  const themeSunAuto = "translate(3.954px,-3.954px) scale(.7)";
  const themeSunStart = "translate(3.954px,2.346px) scale(.7)";
  const themeMoonAuto = "translate(-2.746px,2.746px) scale(.864)";
  const themeAutoExitOpacity = [{ opacity: 1, offset: 0 }, { opacity: 0, offset: .3 }, { opacity: 0, offset: 1 }];
  const themeLightEntryOpacity = [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .25 }, { opacity: .25, offset: .3 }, { opacity: 1, offset: 1 }];

  function initFolderOutline() {
    const outline = document.querySelector(".side-panel-folder-outline");
    const update = () => {
      const width = outline.getBoundingClientRect().width;
      if (!width) return;
      const radius = parseFloat(getComputedStyle(outline).getPropertyValue("--radius-md")) || 12;
      const contour = `M 0.5 46 V ${radius + 0.5} A ${radius} ${radius} 0 0 1 ${radius + 0.5} 0.5 H ${width * 0.45} C ${width * 0.515} 0.5 ${width * 0.515} 46 ${width * 0.58} 46`;
      const backgroundEdge = `M ${width * 0.35} 10.5 H ${width - radius - 0.5} A ${radius} ${radius} 0 0 1 ${width - 0.5} ${10.5 + radius} V ${46 + radius}`;
      const backgroundContour = `${backgroundEdge} A ${radius} ${radius} 0 0 0 ${width - radius - 0.5} 46 H ${width * 0.35} Z`;
      outline.setAttribute("viewBox", `0 0 ${width} 46`);
      outline.querySelectorAll(".side-panel-folder-state").forEach((state) => {
        const background = state.querySelector(".side-panel-folder-inactive-fill");
        state.querySelector(".side-panel-folder-base").setAttribute("width", String(width - 1));
        background.setAttribute("d", backgroundContour);
        state.querySelector(".side-panel-folder-inactive-stroke").setAttribute("d", backgroundEdge);
        state.querySelector(".side-panel-folder-active-fill").setAttribute("d", `${contour} Z`);
        state.querySelector(".side-panel-folder-outer-stroke").setAttribute("d", contour);
        state.querySelector(".side-panel-folder-inner-stroke").setAttribute("d", `M ${width - radius - 0.5} 46 A ${radius} ${radius} 0 0 1 ${width - 0.5} ${46 + radius}`);
      });
      outline.querySelector(".side-panel-folder-state-files").setAttribute("transform", `translate(${width} 0) scale(-1 1)`);
    };
    // Keep corner radii in pixels when the sidebar changes width.
    new ResizeObserver(update).observe(outline);
    update();
  }

  function initSettingsPanel() {
    if (isMobileSettings()) {
      setSettingsSheetState(state.sidePanelTab === "files" ? "medium" : (settingsSheetState || "compact"));
    } else {
      elements.sidePanel.classList.remove(...SETTINGS_SNAP_STATES.map((state) => `mobile-sheet-${state}`), "is-dragging");
      elements.sidePanel.style.removeProperty("--mobile-sheet-height");
      setSettingsCollapsed(false);
    }
    setSidePanelTab(state.sidePanelTab, { save: false, expand: false });
  }

  function setSidePanelTab(tab, { save = true, expand = true } = {}) {
    state.sidePanelTab = tab === "files" ? "files" : "settings";
    const filesActive = state.sidePanelTab === "files";
    elements.settingsTabButton.classList.toggle("active", !filesActive);
    elements.filesTabButton.classList.toggle("active", filesActive);
    elements.settingsTabButton.setAttribute("aria-selected", String(!filesActive));
    elements.filesTabButton.setAttribute("aria-selected", String(filesActive));
    elements.settingsPanelContent.hidden = filesActive;
    elements.filesPanelContent.hidden = !filesActive;
    elements.sidePanel.classList.toggle("files-active", filesActive);
    elements.workspace.classList.toggle("files-active", filesActive);
    if (filesActive) renderFilesPanel();
    if (expand) {
      if (isMobileSettings()) setSettingsSheetState("medium");
      else setSettingsCollapsed(false);
    }
    if (save) saveSettings();
    window.requestAnimationFrame(() => repositionAll());
  }

  function toggleSettingsPanel() {
    if (suppressSettingsToggleClick) {
      suppressSettingsToggleClick = false;
      return;
    }
    if (isMobileSettings()) {
      setSettingsSheetState(settingsSheetState === "collapsed" ? "compact" : "collapsed");
      return;
    }
    setSettingsCollapsed(!elements.sidePanel.classList.contains("collapsed"));
  }

  function setSettingsCollapsed(collapsed) {
    elements.sidePanel.classList.toggle("collapsed", collapsed);
    elements.workspace.classList.toggle("settings-collapsed", collapsed);
    elements.settingsToggleButton.setAttribute("aria-expanded", String(!collapsed));
    updatePanelToggleLabel();
  }

  function updatePanelToggleLabel() {
    const label = t(elements.settingsToggleButton.getAttribute("aria-expanded") === "true" ? "collapsePanel" : "expandPanel");
    elements.settingsToggleButton.title = label;
    elements.settingsToggleButton.setAttribute("aria-label", label);
  }

  function isMobileSettings() {
    return mobileSettingsMedia.matches;
  }

  function setSettingsSheetState(state) {
    const nextState = SETTINGS_SNAP_STATES.includes(state) ? state : "compact";
    settingsSheetState = nextState;
    setSettingsCollapsed(false);
    elements.sidePanel.classList.remove(...SETTINGS_SNAP_STATES.map((entry) => `mobile-sheet-${entry}`), "is-dragging");
    elements.sidePanel.classList.add(`mobile-sheet-${nextState}`);
    elements.sidePanel.style.setProperty("--mobile-sheet-height", `${getSettingsSnapHeights()[nextState]}px`);
    elements.settingsToggleButton.setAttribute("aria-expanded", String(nextState !== "collapsed"));
    updatePanelToggleLabel();
  }

  function refreshSettingsSheetHeight() {
    if (!isMobileSettings() || settingsSheetDrag) return;
    elements.sidePanel.style.setProperty("--mobile-sheet-height", `${getSettingsSnapHeights()[settingsSheetState]}px`);
  }

  function startSettingsSheetDrag(event) {
    if (!isMobileSettings() || event.pointerType === "mouse" && event.button !== 0) return;
    const fromHandle = event.target.closest("#settingsToggleButton");
    if (!fromHandle && shouldIgnoreSettingsDrag(event.target)) return;
    if (!fromHandle && elements.sidePanel.scrollTop > 0) return;

    settingsSheetDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: elements.sidePanel.getBoundingClientRect().height,
      height: elements.sidePanel.getBoundingClientRect().height,
      startedFromHandle: Boolean(fromHandle),
      moved: false
    };
    elements.sidePanel.classList.add("is-dragging");
    elements.sidePanel.setPointerCapture?.(event.pointerId);
  }

  function moveSettingsSheetDrag(event) {
    if (!settingsSheetDrag || event.pointerId !== settingsSheetDrag.pointerId) return;
    const deltaY = event.clientY - settingsSheetDrag.startY;
    if (!settingsSheetDrag.startedFromHandle && deltaY < 0) return;
    if (!settingsSheetDrag.startedFromHandle && elements.sidePanel.scrollTop > 0) return;

    const heights = getSettingsSnapHeights();
    const nextHeight = clamp(settingsSheetDrag.startHeight - deltaY, heights.collapsed, heights.full);
    if (Math.abs(deltaY) > 4) settingsSheetDrag.moved = true;
    settingsSheetDrag.height = nextHeight;
    elements.sidePanel.style.setProperty("--mobile-sheet-height", `${nextHeight}px`);
    event.preventDefault();
  }

  function endSettingsSheetDrag(event) {
    if (!settingsSheetDrag || event.pointerId !== settingsSheetDrag.pointerId) return;
    elements.sidePanel.releasePointerCapture?.(event.pointerId);
    elements.sidePanel.classList.remove("is-dragging");
    if (settingsSheetDrag.moved) {
      setSettingsSheetState(getNearestSettingsSnapState(settingsSheetDrag.height));
      suppressSettingsToggleClick = true;
      window.setTimeout(() => {
        suppressSettingsToggleClick = false;
      }, 180);
    }
    settingsSheetDrag = null;
  }

  function shouldIgnoreSettingsDrag(target) {
    return Boolean(target.closest("button, select, input, textarea, a"));
  }

  function getNearestSettingsSnapState(height) {
    const heights = getSettingsSnapHeights();
    return SETTINGS_SNAP_STATES.reduce((best, state) => {
      const bestDistance = Math.abs(heights[best] - height);
      const distance = Math.abs(heights[state] - height);
      return distance < bestDistance ? state : best;
    }, "compact");
  }

  function getSettingsSnapHeights() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight || 800;
    return {
      collapsed: 54,
      compact: clamp(viewportHeight * 0.18, 118, 168),
      medium: clamp(viewportHeight * 0.34, 230, 360),
      full: Math.max(360, viewportHeight - 12)
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function setShortcutsModalOpen(open) {
    shortcutsModal.setOpen(open);
  }

  function handleKeyboardShortcut(event) {
    if (document.querySelector(".modal-overlay:not([hidden])") && elements.shortcutsModal.hidden) return;
    if (!elements.shortcutsModal.hidden && event.key === "Escape") {
      event.preventDefault();
      setShortcutsModalOpen(false);
      return;
    }
    if (!elements.shortcutsModal.hidden) return;
    if (services.studyController.handleKeyboard(event)) return;
    if (event.key === "Alt") {
      if (!shouldIgnoreTemporaryMode(event.target)) {
        event.preventDefault();
        beginTemporaryWordMode();
      }
      return;
    }
    if (shouldIgnoreKeyboardShortcut(event)) return;
    const key = event.key;
    if (key.toLowerCase() === "f") {
      if (!state.isParsedView || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      setSidePanelTab(state.sidePanelTab === "files" ? "settings" : "files");
      return;
    }
    if (key === "?") {
      event.preventDefault();
      setShortcutsModalOpen(elements.shortcutsModal.hidden);
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      stopPlayback();
      return;
    }
    if (key === " " || key === "Enter") {
      if (event.repeat) return;
      event.preventDefault();
      handlePlaybackButton(event.shiftKey, { source: "keyboard" });
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      const direction = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
      moveKeyboardSelection(direction, key === "ArrowUp" || key === "ArrowDown" ? "vertical" : "horizontal");
      return;
    }
    if (key.toLowerCase() === "w" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setKeyboardClickMode("word");
      return;
    }
    if (key.toLowerCase() === "s" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      setKeyboardClickMode("sentence");
      return;
    }
    if (key.toLowerCase() === "t" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openCurrentTranslation();
      return;
    }
    if (key.toLowerCase() === "l" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      cycleRepeatValue(event.shiftKey);
    }
  }

  function shouldIgnoreKeyboardShortcut(event) {
    if (event.defaultPrevented) return true;
    if (event.ctrlKey || event.metaKey) return true;
    if (event.altKey && !state.temporaryWordMode) return true;
    const target = event.target;
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA"
      || (["Enter", " "].includes(event.key) && (Boolean(target.closest?.("button, a[href], [role='button'], [role='checkbox']"))
        || tag === "BUTTON" || tag === "A"));
  }

  function handleKeyboardKeyUp(event) {
    if (event.key === "Alt") endTemporaryWordMode();
  }

  function shouldIgnoreTemporaryMode(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }

  function setStatus(message) {
    elements.statusText.textContent = message;
  }

  function debounce(fn, delay) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), delay);
    };
  }

  function getThemeMode() {
    const configured = state.saved.theme || state.appConfig?.defaults?.theme;
    return themeModes.includes(configured) ? configured : "auto";
  }

  function updateThemeButtonLabel() {
    const mode = elements.themeToggleButton.dataset.mode || getThemeMode();
    const next = themeModes[(themeModes.indexOf(mode) + 1) % themeModes.length];
    const labels = {
      light: t("themeModeLight"),
      dark: t("themeModeDark"),
      auto: t("themeModeAuto")
    };
    const label = t("themeToggleLabel", labels[mode], labels[next]);
    elements.themeToggleButton.setAttribute("aria-label", label);
    elements.themeToggleButton.title = label;
  }

  function applyThemeMode(mode) {
    const isDark = mode === "dark" || (mode === "auto" && themeSystemQuery.matches);
    const root = document.documentElement;
    // Commit the palette together; component hover timings are not theme timings.
    root.classList.add("theme-switching");
    try {
      root.classList.toggle("dark", isDark);
      root.classList.toggle("light", !isDark);
      root.getBoundingClientRect();
    } finally {
      root.classList.remove("theme-switching");
    }
    elements.themeToggleButton.dataset.mode = mode;
    updateThemeButtonLabel();
  }

  function initTheme() {
    applyThemeMode(getThemeMode());
    if (!isThemeListenerRegistered) {
      isThemeListenerRegistered = true;
      themeSystemQuery.addEventListener("change", () => {
        if (getThemeMode() === "auto") applyThemeMode("auto");
      });
    }
  }

  function cloneThemeAutoSun(sun) {
    const echo = sun.cloneNode(true);
    echo.classList.remove("theme-sun");
    echo.classList.add("theme-auto-exit");
    const originalNodes = [sun, ...sun.querySelectorAll("*")];
    const echoNodes = [echo, ...echo.querySelectorAll("*")];
    originalNodes.forEach((node, index) => {
      const computed = getComputedStyle(node);
      echoNodes[index].style.opacity = computed.opacity;
      if (node instanceof SVGElement) echoNodes[index].style.fill = computed.fill;
    });
    echo.style.color = getComputedStyle(sun).color;
    echo.style.clipPath = themeSunClip;
    sun.parentElement.append(echo);
    return echo;
  }

  function animateThemeMode(previous, next) {
    const button = elements.themeToggleButton;
    const sun = button.querySelector(".theme-sun");
    const moon = button.querySelector(".theme-moon");
    const divider = button.querySelector(".theme-divider");
    const line = divider.querySelector(".theme-line");
    const outgoingSunColor = previous === "light" ? getComputedStyle(button).color : null;
    const softenMoonExit = previous === "auto" && !themeSystemQuery.matches;
    const oldSun = previous === "auto" ? cloneThemeAutoSun(sun) : null;
    applyThemeMode(next);
    const scale = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.001 : 1;
    const motions = [];
    const move = (element, frames, duration) => motions.push(element.animate(frames, {
      duration: duration * scale, easing: "cubic-bezier(.2,.82,.22,1)", fill: "both"
    }));
    if (previous === "light") {
      move(sun, [{ transform: "rotate(0deg)", clipPath: themeFullClip, color: outgoingSunColor, opacity: 1 }, { transform: "rotate(-58deg)", clipPath: themeFullClip, color: outgoingSunColor, opacity: 0 }], 540);
      move(moon, [{ transform: "rotate(58deg)", clipPath: themeFullClip }, { transform: "rotate(0deg)", clipPath: themeFullClip }], 270);
    } else if (previous === "dark") {
      move(moon, [{ transform: "rotate(0deg)", clipPath: themeFullClip }, { transform: "rotate(0deg)", clipPath: themeMoonClip }], 300);
      move(moon.querySelector("svg"), [{ transform: "translate(2px,-1px)" }, { transform: themeMoonAuto }], 300);
      move(sun, [{ transform: "rotate(0deg)", clipPath: themeSunClip, opacity: .25 }, { transform: "rotate(0deg)", clipPath: themeSunClip, opacity: 1 }], 640);
      move(sun.querySelector("svg"), [{ transform: themeSunStart }, { transform: themeSunAuto }], 640);
      move(divider, [{ transform: "rotate(0deg)", opacity: 1 }, { transform: "rotate(0deg)", opacity: 1 }], 640);
      move(line, [{ strokeDashoffset: 29 }, { strokeDashoffset: 0 }], 640);
    } else {
      move(sun, [{ transform: "rotate(0deg)", clipPath: themeSunClip }, { transform: "rotate(0deg)", clipPath: themeFullClip }], 540);
      move(sun.querySelector("svg"), [{ transform: themeSunAuto }, { transform: themeSunFull }], 540);
      move(sun, themeLightEntryOpacity, 540);
      move(oldSun, themeAutoExitOpacity, 540);
      move(oldSun.querySelector("svg"), [{ transform: themeSunAuto }, { transform: themeSunFull }], 540);
      move(moon, [{ transform: "rotate(0deg)", clipPath: themeMoonClip, opacity: 1 }, { transform: "rotate(-58deg)", clipPath: themeMoonClip, opacity: softenMoonExit ? .45 : 1 }], 540);
      move(moon.querySelector("svg"), [{ transform: themeMoonAuto }, { transform: themeMoonAuto }], 540);
      move(divider, [{ transform: "rotate(0deg)", opacity: 1 }, { transform: "rotate(-58deg)", opacity: 0 }], 540);
      move(line, [{ strokeDashoffset: 0 }, { strokeDashoffset: 0 }], 540);
    }
    const finish = () => {
      motions.forEach((motion) => motion.cancel());
      oldSun?.remove();
      if (finishThemeMotion === finish) finishThemeMotion = null;
    };
    finishThemeMotion = finish;
    Promise.allSettled(motions.map((motion) => motion.finished)).then(finish);
  }

  function toggleTheme() {
    if (finishThemeMotion) finishThemeMotion();
    const previous = elements.themeToggleButton.dataset.mode || getThemeMode();
    const next = themeModes[(themeModes.indexOf(previous) + 1) % themeModes.length];
    animateThemeMode(previous, next);
    state.saved.theme = next;
    saveSettings();
  }

  function bindEvents() {
    elements.settingsToggleButton.addEventListener("click", toggleSettingsPanel);
    elements.settingsTabButton.addEventListener("click", () => setSidePanelTab("settings"));
    elements.filesTabButton.addEventListener("click", () => setSidePanelTab("files"));
    elements.sidePanel.addEventListener("pointerdown", startSettingsSheetDrag);
    window.addEventListener("pointermove", moveSettingsSheetDrag, { passive: false });
    window.addEventListener("pointerup", endSettingsSheetDrag);
    window.addEventListener("pointercancel", endSettingsSheetDrag);
    window.addEventListener("resize", refreshSettingsSheetHeight);
    window.visualViewport?.addEventListener("resize", refreshSettingsSheetHeight);
    mobileSettingsMedia.addEventListener("change", initSettingsPanel);


    elements.themeToggleButton.addEventListener("click", toggleTheme);
    elements.shortcutsHelpButton.addEventListener("click", () => {
      setShortcutsModalOpen(true);
    });
    shortcutsModal.bindEvents();
    document.addEventListener("keydown", handleKeyboardShortcut);
    document.addEventListener("keyup", handleKeyboardKeyUp);
    window.addEventListener("blur", endTemporaryWordMode);

    // Initialize generic segmented controls and custom range inputs
    initSegmentedControls();
    initCustomSliders();
    window.addEventListener('resize', () => repositionAll());
    window.addEventListener('resize', () => {
      if (state.isParsedView && state.parsedViewMode === "reader") {
        updateActiveTableState();
      }
    });}

  return { initFolderOutline, initSettingsPanel, setSidePanelTab, toggleSettingsPanel, setSettingsCollapsed, updatePanelToggleLabel, isMobileSettings, setSettingsSheetState, refreshSettingsSheetHeight, startSettingsSheetDrag, moveSettingsSheetDrag, endSettingsSheetDrag, shouldIgnoreSettingsDrag, getNearestSettingsSnapState, getSettingsSnapHeights, clamp, setShortcutsModalOpen, handleKeyboardShortcut, shouldIgnoreKeyboardShortcut, handleKeyboardKeyUp, shouldIgnoreTemporaryMode, setStatus, debounce, getThemeMode, updateThemeButtonLabel, applyThemeMode, initTheme, cloneThemeAutoSun, animateThemeMode, toggleTheme, bindEvents };
}
