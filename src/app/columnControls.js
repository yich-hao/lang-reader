import { getSpeechLanguages, getLanguage, getLanguageLabel } from "../i18n/languages.js";
import { DEFAULT_TAG } from "../core/config.js";
import { getShrinkCapacity } from "../ui/tableLayout.js";
import { SPEAKER_ON_SVG, SPEAKER_MUTE_SVG } from "../ui/uiIcons.js";

export function createColumnControls({ document, window, state, t, saveSettings, onColumnChange,
  getLanguageOptions,
  cleanTag, normalizeSingleRole, defaultLanguageForColumn, getColumnCount, getRenderedColumnWidths,
  getMinColumnWidth, redistributeColumnWidths, applyColumnLayout, getCurrentRenderedColumnWidths }) {
  function renderColumnControls(index) {
    const wrap = document.createElement("div");
    wrap.className = "column-controls";

    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = `mute-toggle ${state.columnRoles[index] === "mute" ? "is-muted" : ""}`;
    muteButton.innerHTML = state.columnRoles[index] === "mute" ? SPEAKER_MUTE_SVG : SPEAKER_ON_SVG;
    muteButton.title = t("roleMute");
    muteButton.setAttribute("aria-label", muteButton.title);
    muteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.columnRoles = [...state.columnRoles];
      state.columnRoles[index] = state.columnRoles[index] === "mute" ? "sentence" : "mute";
      saveSettings();
      onColumnChange(index);
    });

    const hideButton = document.createElement("button");
    hideButton.type = "button";
    hideButton.className = "hide-column-button";
    hideButton.textContent = "▮";
    hideButton.title = t("roleHide");
    hideButton.setAttribute("aria-label", hideButton.title);
    hideButton.addEventListener("click", (event) => {
      event.stopPropagation();
      state.columnRoles = [...state.columnRoles];
      state.hiddenPreviousRoles[index] = state.columnRoles[index] === "hide" ? "sentence" : state.columnRoles[index];
      state.columnRoles[index] = "hide";
      saveSettings();
      onColumnChange(index);
    });

    wrap.append(renderColumnTagEditor(index), muteButton, renderLanguagePicker(index), hideButton);
    return wrap;
  }

  function renderColumnTagEditor(index) {
    const editor = document.createElement("div");
    editor.className = "column-tag-editor";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "column-tag-button";
    const label = document.createElement("span");
    label.textContent = cleanTag(state.columnTags[index] || DEFAULT_TAG);
    const mark = document.createElement("span");
    mark.className = "tag-edit-mark";
    mark.textContent = "⌄";
    button.append(label, mark);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (editor.classList.contains("open")) { closeTagEditors(); return; }
      closeTagEditors(editor);
      editor.classList.add("open");
      button.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      menu.classList.add("is-open");
      document.body.append(menu);
      if (menu.showPopover) menu.showPopover();
      positionTagMenu(editor);
      input.focus({ preventScroll: true });
    });

    const menu = document.createElement("div");
    menu.className = "column-tag-menu";
    menu.hidden = true;
    menu.setAttribute("popover", "manual");
    editor.tagMenu = menu;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", t("tag"));
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeTagEditors();
      button.focus({ preventScroll: true });
    });
    ["word", "translation", "sentence", "example", "note"].forEach((tag) => {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = tag;
      option.addEventListener("click", (event) => {
        event.stopPropagation();
        setColumnTag(index, tag);
      });
      menu.append(option);
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = "";
    input.placeholder = cleanTag(state.columnTags[index] || DEFAULT_TAG);
    input.ariaLabel = t("tag");
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") setColumnTag(index, input.value);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeTagEditors();
        button.focus({ preventScroll: true });
      }
    });
    input.addEventListener("change", () => setColumnTag(index, input.value));
    menu.append(input);

    editor.append(button, menu);
    return editor;
  }

  function setColumnTag(index, value) {
    if (!String(value || "").trim()) {
      closeTagEditors();
      return;
    }
    const previousLanguage = state.columnLanguages[index];
    state.columnTags = [...state.columnTags];
    state.columnTags[index] = cleanTag(value);
    if (!state.manualColumnLanguages[index]) {
      state.columnLanguages = [...state.columnLanguages];
      state.columnLanguages[index] = defaultLanguageForColumn(index);
    }
    closeTagEditors();
    saveSettings();
    onColumnChange(index, { tagChanged: true, languageChanged: previousLanguage !== state.columnLanguages[index] });
  }

  function renderHiddenColumnButton(index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hidden-column-button";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>';
    button.title = t("showColumn");
    button.setAttribute("aria-label", button.title);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.columnRoles = [...state.columnRoles];
      state.columnRoles[index] = normalizeSingleRole(state.hiddenPreviousRoles[index] || "sentence");
      saveSettings();
      onColumnChange(index);
    });
    return button;
  }

  function renderResizeHandle(index) {
    const handle = document.createElement("span");
    handle.className = "column-resize-handle";
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const columnCount = getColumnCount();
      const startWidths = getRenderedColumnWidths(columnCount);
      const startWidth = startWidths[index];
      const minWidth = getMinColumnWidth(index);
      const maxWidth = startWidth + getShrinkCapacity(startWidths, index, state.columnRoles);
      const onMove = (moveEvent) => {
        const nextWidth = Math.round(Math.max(minWidth, Math.min(maxWidth, startWidth + moveEvent.clientX - startX)));
        const nextWidths = redistributeColumnWidths(startWidths, index, nextWidth);
        applyColumnLayout(columnCount, nextWidths);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const widths = getCurrentRenderedColumnWidths(columnCount);
        widths.forEach((width, widthIndex) => {
          if (state.columnRoles[widthIndex] !== "hide") state.columnWidths[widthIndex] = Math.round(width);
        });
        saveSettings();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    return handle;
  }

  function renderLanguagePicker(index) {
    const picker = document.createElement("div");
    picker.className = "language-picker";
    const current = state.columnLanguages[index] || state.targetLanguage;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `language-dot lang-${current}`;
    button.textContent = getLanguage(current).short;
    button.title = `${getLanguageLabel(current, state.uiLanguage)} · ${t("languageSearch")}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      closeLanguagePickers(picker);
      picker.classList.toggle("open");
      const open = picker.classList.contains("open");
      button.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
      if (open) {
        renderLanguageOptions(menu, index, search.value || "");
        document.body.append(menu);
        if (menu.showPopover) menu.showPopover();
        positionLanguageMenu(picker);
        search.focus({ preventScroll: true });
      } else {
        if (menu.hidePopover && menu.matches(":popover-open")) menu.hidePopover();
        picker.append(menu);
      }
    });

    const menu = document.createElement("div");
    menu.className = "language-menu";
    menu.hidden = true;
    menu.setAttribute("popover", "manual");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", t("languageSearch"));
    picker.languageMenu = menu;
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = t("languageSearch");
    search.setAttribute("aria-label", t("languageSearch"));
    search.addEventListener("click", (event) => event.stopPropagation());
    search.addEventListener("input", () => renderLanguageOptions(menu, index, search.value));
    menu.append(search);
    menu.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeLanguagePickers();
      button.focus({ preventScroll: true });
    });
    renderLanguageOptions(menu, index, "");

    picker.append(button, menu);
    return picker;
  }

  function positionLanguageMenu(picker) {
    const menu = picker.languageMenu;
    const button = picker.querySelector(".language-dot");
    if (!menu || !button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(220, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${window.innerHeight - 16}px`;
    const height = menu.getBoundingClientRect().height;
    const below = rect.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 6);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
  }

  function renderLanguageOptions(menu, columnIndex, query) {
    menu.querySelectorAll(".language-option").forEach((node) => node.remove());
    const normalizedQuery = query.trim().toLowerCase();
    (getLanguageOptions?.() || getSpeechLanguages(window.speechSynthesis?.getVoices() || [],
      [state.targetLanguage, state.translationLanguage, ...(state.columnLanguages || [])]))
      .filter((language) => {
        const haystack = `${language.code} ${language.short} ${Object.values(language.names).join(" ")}`.toLowerCase();
        return !normalizedQuery || haystack.includes(normalizedQuery);
      })
      .forEach((language) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "language-option";
        const badge = document.createElement("span"), label = document.createElement("span");
        badge.className = `language-badge lang-${language.code}`; badge.textContent = language.short;
        label.textContent = getLanguageLabel(language.code, state.uiLanguage) + (language.currentDocument ? " · " + t("currentDocumentLanguage") : "");
        option.append(badge,label);
        option.addEventListener("click", (event) => {
          event.stopPropagation();
          const previousLanguage = state.columnLanguages[columnIndex];
          state.columnLanguages[columnIndex] = language.code;
          state.manualColumnLanguages[columnIndex] = true;
          saveSettings();
          closeLanguagePickers();
          onColumnChange(columnIndex, { languageChanged: previousLanguage !== language.code });
        });
        menu.append(option);
      });
  }

  function closeLanguagePickers(except = null) {
    document.querySelectorAll(".language-picker.open").forEach((picker) => {
      if (picker === except) return;
      const menu = picker.languageMenu;
      if (menu?.hidePopover && menu.matches(":popover-open")) menu.hidePopover();
      if (menu) { menu.hidden = true; picker.append(menu); }
      picker.classList.remove("open");
      picker.querySelector(".language-dot").setAttribute("aria-expanded", "false");
    });
  }

  function closeTagEditors(except = null) {
    document.querySelectorAll(".column-tag-editor.open").forEach((editor) => {
      if (editor === except) return;
      const menu = editor.tagMenu;
      if (menu?.hidePopover && menu.matches(":popover-open")) menu.hidePopover();
      if (menu) { menu.hidden = true; menu.classList.remove("is-open"); editor.append(menu); }
      editor.classList.remove("open");
      editor.querySelector(".column-tag-button").setAttribute("aria-expanded", "false");
    });
  }

  function positionTagMenu(editor) {
    const menu = editor.tagMenu;
    const button = editor.querySelector(".column-tag-button");
    if (!menu || !button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(190, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${window.innerHeight - 16}px`;
    const height = menu.getBoundingClientRect().height;
    const below = rect.bottom + 4;
    menu.style.top = `${below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 4)}px`;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left))}px`;
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".language-picker,.language-menu")) closeLanguagePickers();
      if (!event.target.closest(".column-tag-editor,.column-tag-menu")) closeTagEditors();
    });

    window.addEventListener("resize", () => { closeLanguagePickers(); closeTagEditors(); });
    document.addEventListener("scroll", event => {
      if (!event.target.closest?.(".language-menu")) closeLanguagePickers();
      if (!event.target.closest?.(".column-tag-menu")) closeTagEditors();
    }, true);
  }

  return { renderColumnControls, renderHiddenColumnButton, renderResizeHandle, closeLanguagePickers,
    closeTagEditors, setColumnTag, renderLanguageOptions, bindEvents };
}
