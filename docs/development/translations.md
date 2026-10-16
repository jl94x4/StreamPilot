# Localization Guide

This guide explains how to contribute UI translations to StreamPilot.

It applies to French, German, Spanish, Portuguese (Brazil), Italian, Japanese, Polish, Dutch, Russian, and future locales. Keep translation changes focused, reviewable, and aligned with the project's current localization architecture.

## Localization Architecture

Most translated UI chrome uses the Discover i18n system:

| File / API | Purpose |
| --- | --- |
| `client/discovery/i18n/en.ts` | Source catalog. English strings live here first. |
| `client/discovery/i18n/fr.ts`, `de.ts`, `es.ts`, and additional locale files | Locale overlays. These may be partial and mirror English keys where translated strings exist. |
| `client/discovery/i18n/types.ts` | Supported locale metadata for the language menu. |
| `client/discovery/i18n/index.tsx` | Catalog registry, provider, and translation helper. |
| `DiscoverI18nProvider` | React provider for the active UI locale. |
| `useDiscoverI18n()` | React hook for translated UI. |
| `t('dot.path')` | Translation lookup helper. |

English is the source catalog. Missing locale keys fall back to English, so partially translated locales remain usable.

The current supported UI locales are `en`, `fr`, `de`, `es`, `pt-BR`, `it`, `ja`, `pl`, `nl`, and `ru`. `pt-BR` is a regional locale and must remain distinct from generic Portuguese. The newly registered locale overlays may be partial; registration does not imply complete translation coverage.

Do not introduce another global localization system. When adding localized UI chrome to the wider portal, prefer extending the existing Discover catalogs and wiring the UI through `useDiscoverI18n()` / `t(...)`.

### Achievements Exception

Achievements has a maintainer-owned feature-local i18n helper:

| File / API | Purpose |
| --- | --- |
| `client/achievements/i18n.ts` | Achievements translation catalog and helper. |
| `tAchievements()` | Feature-local translation lookup. |
| `useAchievementsI18n()` | React hook for live locale updates in Achievements UI. |

Do not migrate Achievements strings into `client/discovery/i18n/*` unless the maintainer explicitly asks for that architecture change.

## What Belongs In Translation Catalogs

Translate rendered UI chrome, including:

- headings
- tabs
- buttons
- labels
- hints and helper text
- empty states
- loading states
- local fallback errors
- confirmation dialogs
- toast chrome
- option display labels
- accessibility labels
- tooltips
- rendered status labels

If the user can see it as application UI, and it is not backend/user/external data, it is usually a translation candidate.

## What Usually Should Not Be Translated

Do not translate data, identifiers, or external content such as:

- backend/API error bodies
- log output
- user-entered data
- media titles
- library names
- configured service or server names
- URLs
- paths
- filenames
- IDs
- invite tokens
- API keys
- enum/internal values
- command output
- provider metadata
- backend-generated status payloads

Product and service names generally remain intact where natural, such as Plex, Jellyfin, Tautulli, Overseerr, Bazarr, Kometa, and ColleXions.

However, do not treat every English phrase near a product feature as a product name. Internal values and visible labels are different:

| Example | Treatment |
| --- | --- |
| `new-season` internal ID | Keep unchanged. |
| Visible label `New season window` | Translate naturally. |

## Translation Quality Rules

- Preserve placeholders exactly: `{count}`, `{days}`, `{name}`, `{pct}`, `{time}`, etc.
- Preserve plural sibling behavior. If English has `key` and `key_plural`, locale catalogs should mirror that pattern.
- Preserve developer English wording in `en.ts` when moving hardcoded text into the catalog.
- Locale text should be natural UI language, not word-for-word translation.
- Keep product names unchanged where that reads naturally.
- Keep internal values and display labels separate.
- Never use translated labels as business logic, state identifiers, action IDs, enum values, or API payload values.
- Do not change behavior, permissions, routes, persisted data, API calls, or calculations while localizing UI.

## Locale Reactivity

Translated React UI must update immediately when the language changes. It should not require a page refresh.

When translations are used inside React memoization or callbacks, include the correct dependencies:

- `useMemo`
- `useCallback`
- effects that derive visible translated text
- objects or arrays containing translated labels

If a component uses translated labels but does not subscribe to locale state, it may render stale text after the user changes language.

## Finding Untranslated UI

Use both code search and manual review.

Code search helps find candidate strings, but not every string literal is translatable. Review each candidate semantically.

Classify strings as:

- translate
- reuse existing key
- add new key
- do not translate
- maintainer decision

Distinguish rendered UI strings from:

- comments
- logs
- backend strings
- internal constants
- sample data
- test fixtures
- API payload values
- user/configuration data

Search the target module first, then inspect directly related components only as needed. Avoid turning a focused translation PR into a full-portal rewrite.

## Safe Synchronization With Active Development

Translation work often targets `nightly`, which may change while a contribution is in progress.

Latest upstream code is authoritative. A localization change must be reapplied onto current maintainer behavior, not by restoring an older component implementation.

### Before Starting A Translation Batch

Fetch upstream and make sure your branch is based on the latest target branch:

```bash
git fetch upstream
```

If your fork uses a different remote name, adapt the command accordingly.

### Before Committing

Fetch upstream again.

If upstream changed the same files, reconcile your work against the latest upstream code before committing. Preserve new maintainer behavior and reapply only the localization layer.

Do not blindly resolve conflicts using only "ours" or "theirs". Resolve conflicts semantically.

### Before Pushing Or Updating A PR

Fetch upstream again.

If the target branch moved in areas you touched, rebase or reconcile before pushing. Confirm that the final diff is still focused on localization.

## Recommended Translation Workflow

1. Synchronize with the target branch.
2. Audit the target module before editing.
3. Classify user-visible strings.
4. Select a focused scope.
5. Reuse existing keys where semantically correct.
6. Add new English source keys to `en.ts` when needed.
7. Add matching locale overlay keys.
8. Wire rendered UI through the existing i18n helper.
9. Preserve backend, API, state, and business behavior.
10. Run catalog parity and placeholder checks.
11. Search the target area again for remaining hardcoded rendered UI.
12. Run the relevant build.
13. Manually switch English to the target locale and back.
14. Fetch upstream again before committing.
15. Open a focused PR with verification notes.

## PR Sizing

Small coherent batches are preferred.

Good PR scopes include:

- one settings panel
- one dashboard
- one modal family
- one Home widget group
- one feature subpage

Avoid translating an entire 300-400 string module in one PR if it can be split cleanly.

Settings wrappers and full dashboards can be separate batches. Translation PRs should avoid unrelated refactoring, formatting churn, and architecture changes.

## Verification Checklist

Before opening a translation PR, verify:

- source and locale catalogs are structurally aligned
- missing locale keys are expected or zero
- extra locale keys are intentional or zero
- placeholders match exactly
- plural sibling keys match the English structure
- dead keys were not introduced
- duplicate keys were not introduced where detectable
- English source wording was preserved
- locale text preserves the full meaning
- translated UI updates immediately after changing language
- remaining hardcoded strings are intentionally untranslated
- no backend/API/user/config data was translated
- no business logic or state behavior changed
- changed files match the intended scope

Recommended commands:

```bash
git diff --check
npm run build:js
```

Use `npm run build` when the change needs the full build.

Also perform a manual locale spot check:

1. Load the affected UI in English.
2. Switch to the target locale.
3. Confirm visible chrome updates without refresh.
4. Switch back to English.
5. Confirm English still matches the source wording.

## Current Project Status

For the current i18n coverage, remaining localization areas, and recommended contribution roadmap, see the [Localization Status](translation-status.md).

Re-audit the current target branch before starting work because `nightly` changes frequently.

## Maintaining This Document

When a translation PR materially changes i18n wiring or module coverage, update the coverage section when appropriate.

The public coverage table tracks i18n wiring and broad module coverage, not exact per-locale completion.

Do not turn this document into a per-PR changelog. Per-locale details, exact key counts, PR history, commit SHAs, roadmaps for a specific language, local branch or stash information, and audit history belong outside this public guide.
