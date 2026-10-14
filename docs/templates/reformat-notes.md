---
mode: reader
target: en
translation: en
---

# Reformat Prompt

```text
Reformat my notes using these rules.

- Mode: reader for prose/notes; vocabulary for word lists/tables. Ask if unclear.
- Preserve compatible formatting, content, order, and settings. Do not rewrite,
  invent content, or split files unless asked.
- This reference's header/examples are not my notes. Output only my document.

# File header
Preserve valid headers; add one only if needed/requested, at the start of Markdown.
Infer the languages; ask if uncertain. Use BCP 47 tags:

---
mode: reader
target: de
translation: en
---

mode: reader / vocabulary; study only if requested. translation: na = target.
Preserve optional settings; add only if requested:
  click_mode / play_mode: word / sentence / paragraph / cell (Vocabulary)
  loop_count: 1–20 / infinite
  unit_gap: 0–1 by 0.1; 1–5 by 0.5; 5–30 by 1 (seconds)
  speech: all / apple / google / microsoft
  speed: 0.5–3 by 0.05
One setting per line; # comments disable settings (example: # speed: 1.2).
No Markdown header in CSV/TSV files.

# Shared formatting
# through ######: headings; - / * / +: bullets; blank lines: separate sections.
Heading example: ## Frühstück [Breakfast].
Simple emphasis, inline code and ==highlights== become plain text.
Silent instructions/examples use three-backtick fences:
Opening example: ```text
Body example: Review these words tomorrow.
Closing example: ```

# Inline content
Reader: keep paragraphs; add [translations] after matching words/phrases/passages,
with punctuation matching the translated scope:
  Emma reads [阅读] a short line.
  We meet by the river [在河边].
  Ich bin hier. Ich lerne. [我在这里。我在学习。]
Silent Reader notes: {inline note} or a > note-only line:
  das Brot {neuter noun}
  > Review this tomorrow.
Links: [label](https://example.com), not [translation].
Images contribute alt text: ![Breakfast](breakfast.png).

# Vocabulary rows
Preserve any working row format:
  das Brot [bread] -> Ich esse Brot.
  das Brot [bread]
  das Brot - bread - Ich esse Brot.
  das Brot - bread
  das Brot -> Ich esse Brot.
  das Brot
Columns: word/phrase, translation/explanation, optional examples.
Arrows: -> / → / =>. Separators: spaced - / – / — / =; preserve word hyphens.
First [translation] = translation column; word -> sentence leaves it empty.
Semicolons outside brackets separate entries:
  lernen [to learn]; lesen [to read; to read aloud]
Bare words need a structured list. Single entry: word [translation]; other compact
formats need two structured rows. Keep free prose out of tables.

# Tables
Reader: Markdown; Vocabulary: Markdown/CSV/TSV. Preserve columns and empty cells.
Markdown needs headers and a separator:
  | Word | Translation | Sentence |
  |---|---|---|
  | das Brot | bread | Ich esse Brot. |
Reader translation cell: | Guten Morgen. | [Good morning.] |
Reader cell line breaks: <br>, <br/>, <br />. One physical line per table row.
No literal pipes in Vocabulary Markdown cells, even escaped.
CSV: commas, quoted fields, doubled quotes. TSV: actual tabs:
  Word,Translation
  das Brot,bread
  Word<TAB>Translation
  das Brot<TAB>bread
Replace <TAB> with tabs. Preserve valid headerless tables; new CSV/TSV headers
should include Translation. Labels do not set column languages/roles.

Check mode, header, brackets, fences, columns, and content preservation.
Return the document without a wrapper code fence.
```
