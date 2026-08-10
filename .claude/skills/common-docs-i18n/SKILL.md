---
name: common-docs-i18n
description: Sync documentation between English (.md) and Chinese (.zh.md). Triggered when creating or modifying README.md or docs/*.md — automatically maintain the corresponding translated version and language-switcher links.
---

# Docs i18n Sync

Maintain bilingual (English ↔ Chinese) documentation for this project by keeping
`.md` and `.zh.md` files in sync.

## Naming convention

| Language          | Pattern        | Example                                |
| ----------------- | -------------- | -------------------------------------- |
| English (primary) | `<name>.md`    | `README.md`, `docs/blueprint.md`       |
| Chinese           | `<name>.zh.md` | `README.zh.md`, `docs/blueprint.zh.md` |

The `.zh.md` suffix is the industry-standard convention used by major open-source
projects (React, Vue, Vite, etc.).

## When to trigger

Automatically sync when you:

- **Create** a new markdown file matching `README.md` or `docs/**/*.md` (excluding
  `.zh.md` files themselves)
- **Modify** an existing `README.md` or `docs/**/*.md` (English source)
- **Modify** a `.zh.md` file (Chinese source — sync back to English)

## Sync rules

### When the English file is the source of truth (new file, or you just edited it)

1. Read the English `.md` file
2. Check if the corresponding `.zh.md` file exists
3. If it **does not exist**: create it with a full Chinese translation.
   Preserve all structure, code blocks, links, and images exactly as-is.
   Translate prose text to Chinese. Keep technical terms in their original
   language (e.g., "API", "MCP", "RAG", "TypeScript", "PostgreSQL").
4. If it **exists**: diff the changes and translate only the
   added/modified sections into the `.zh.md` file. Match section ordering
   and structure exactly.

### When the Chinese file is the source of truth

1. Apply the same logic in reverse: sync changes from `.zh.md` back to `.md`.

### Translation guidelines

- **Preserve exactly**: code blocks, URLs, image paths, HTML tags, frontmatter
- **Translate prose**: headings, paragraphs, list item text, table cell content
- **Keep untranslated**: technical proper nouns (API, MCP, RAG, SDK, TypeScript,
  PostgreSQL, Next.js), brand names (Cursor, Claude, Apigent), code identifiers
- **Match structure**: heading levels, list nesting, table dimensions must be
  identical between the two files
- **Link references**: `[text](./foo.md)` keeps the same target path — both
  language versions link to the English doc; do NOT rewrite links to point to
  `.zh.md` (the English doc is canonical for links)

### What NOT to sync

- Do NOT create `.zh.md` for files outside `README.md` and `docs/`
- Do NOT translate content inside code blocks (`...`)
- Do NOT translate YAML/JSON frontmatter field values unless they are
  human-facing prose

## Example

Creating `docs/blueprint.zh.md` from `docs/blueprint.md`:

```
Source:   docs/blueprint.md          (English, all prose in EN)
Target:   docs/blueprint.zh.md       (Chinese, same structure, prose in ZH)
```

Both files share identical:

- Section hierarchy (`#`, `##`, `###`)
- Code blocks and diagrams
- Inline code spans
- Link targets
- Table dimensions

Only paragraph text, heading text, and list item text differ (translated).

## Language switcher

Every paired doc must include a language-switcher block at the very top,
immediately after the title (and frontmatter, if any):

```markdown
> 🌐 Language: [English](./README.md) | [中文](./README.zh.md)
```

Rules:

- The switcher is the **first line after the top-level heading** (or
  frontmatter).
- Link targets are relative paths to the sibling file in the other
  language — `./foo.md` ↔ `./foo.zh.md`.
- When creating a new `.zh.md` file, add the switcher to **both** the
  source and the new translated file.
- When editing a file that already has a switcher, leave it untouched.

## Gotchas

- **Frontmatter in `.zh.md`**: Copy frontmatter verbatim from the English
  source unless a field is explicitly a human-readable description that
  warrants translation.
- **Mixed-language files**: If an English doc contains pre-existing Chinese
  text (e.g., in examples), preserve it as-is — do not double-translate.
- **New sections added to English**: Translate the new heading text AND its
  body content. Do not leave Chinese headings in English.
- **File renames**: If `docs/foo.md` is renamed to `docs/bar.md`, also
  rename `docs/foo.zh.md` to `docs/bar.zh.md`.
