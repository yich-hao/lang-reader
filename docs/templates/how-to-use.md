---
mode: reader       # reader/vocabulary
target: en         # language code, e.g. en/de/zh/bg/ja/fr-FR
translation: na    # language code or mix/na (same as target)
# click_mode: word       # word/sentence/paragraph; cell also works in Vocabulary
# play_mode: sentence    # word/sentence/paragraph; paragraph means cell in Vocabulary
# loop_count: 2          # 1-20 or infinite
# unit_gap: 0.3          # seconds: 0-1 by 0.1; 1-5 by 0.5; 5-30 by 1
# speech: all            # all/apple/google/microsoft; A/G/M also work
# speed: 1.0             # 0.5-3 in steps of 0.05
# mode: study            # Vocabulary parsing, then Study setup; no automatic exercise
---

# Lang Reader Guide

Source code & Deploy locally: [https://github.com/yich-hao/lang-reader](https://github.com/yich-hao/lang-reader)

```text
This guide uses Reader mode.
Click Translate this page to translate the guide and page.
```

## Files

Guides and Templates contains built-in guides, templates, and prompts.

Use the upload icons beside Uploaded Files and Uploaded Folders to import from your device; folders retain their hierarchy. The plus beside Drafts creates a blank Markdown document.

Select a file to open it. Trash icons remove drafts or imports; a group's trash clears that group after confirmation. Device originals are not deleted.

## Parse Modes

Settings in the opening `---` block travel with the file. View the source and remove a leading `#` to enable an example option. File settings take priority over saved preferences when opened. You can still adjust the controls afterward. Parse preserves those changes. Unspecified options use this file's saved preferences or browser defaults, not another file's overrides.

The file's `speech` option selects a platform, not a specific voice; unavailable platforms fall back to All. Volume is a browser setting. `mode: study` opens setup for eligible Vocabulary content, without starting a session.

Reader mode keeps Markdown structure for notes, articles, lists, and tables.

Vocabulary mode displays structured lists and tables in columns with selectable roles and languages.

## Edit And Reparse

Click Show Raw to view a guide or template's read-only source. For your own files, Edit opens the current source without resetting your changes.

Use More actions → Create Draft Copy to customize a separate browser draft.

New Draft opens a blank editor. Writing content saves it in the browser; parsing an empty Draft discards it and returns to the preceding document.

More actions → Download file exports the current source without overwriting the device original. A pencil file icon marks content not yet exported.

Click Parse after editing to rebuild the view. Exit Show Raw to return to reading.

## Translation Markup

Write translations in square brackets: [translation text].

In Reader, Translation [...] shows or hides bracket translations. The Read Translation speaker toggle includes them in playback. These controls appear only when the document contains translations.

Translate this page uses the optional Google widget, separate from document translations and selected-text translation links.

## Playback

Click words, sentences, or cells to hear them.

The cursor-icon setting controls clicks (Word by default); the triangle-icon setting controls Play and Auto Play (Sentence by default). Choose Word, Sentence, or Paragraph/Cell independently. Play reads the current range; Auto Play continues through the document.

CNT (Loop count): 1–20 or unlimited. GAP (Unit gap): 0–1s in 0.1s steps, 1–5s in 0.5s steps, and 5–30s in 1s steps; default 0.3s. The file option `unit_gap` uses the same values.

## Voices

Speech uses browser/system voices. Select a provider, then a voice for each active document language.

Target, Translation, and column languages include the voices available in your browser; UI language is separate. Japanese and other unspaced languages use word segmentation. Chinese keeps character-by-character Word mode. Voice availability varies by browser and device.

The speedometer adjusts speed (0.5–3×); the speaker adjusts volume (0–100%).

## Study

Study is available for valid Vocabulary content with word–translation pairs. Rows without a word or translation are skipped.

Select a section, then Learn, Recall, or Dictation, the order, and session size. Selections of 10 cards or fewer use All.

The top-right cross exits Study home to Vocabulary; on later screens it returns home.

Progress is saved in the browser. Import and Export transfer Study JSON backups.
