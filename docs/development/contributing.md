# Contributing

## Local Development

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set `JWT_SECRET`, then run:

```bash
npm start
```

The app builds before it starts. During frontend work, rerun `npm run build` after changing React or Tailwind files.

## Build Commands

| Command | Purpose |
| --- | --- |
| `npm run build:css` | Build Tailwind CSS into `static/tailwind.css` |
| `npm run build:js` | Bundle React into `static/bundle.js` |
| `npm run build:version` | Update `version.txt` |
| `npm run build` | Run all app build steps |
| `npm run docs:dev` | Start the VitePress docs dev server |
| `npm run docs:build` | Build the static docs site |
| `npm run docs:preview` | Preview the built docs site |

## Translations

UI chrome for Discover, Request, and Home Wrap-Up is translated via TypeScript catalogs under `client/discovery/i18n/`. The language selector stores the choice in the user's preferences when available and keeps `localStorage` (`discoverUiLocale`) as a compatibility fallback. Missing keys fall back to English, so a partially translated locale still works — unfinished screens stay in English until strings are added.

**Current locales:** English (`en`), French (`fr`), German (`de`), Spanish (`es`), Brazilian Portuguese (`pt-BR`), Italian (`it`), Japanese (`ja`), Polish (`pl`), Dutch (`nl`), and Russian (`ru`).

| File | Role |
| --- | --- |
| `client/discovery/i18n/en.ts` | Source catalog (complete English strings) |
| `client/discovery/i18n/fr.ts` | French (`fr`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/de.ts` | German (`de`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/es.ts` | Spanish (`es`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/pt-BR.ts` | Brazilian Portuguese (`pt-BR`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/it.ts` | Italian (`it`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/ja.ts` | Japanese (`ja`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/pl.ts` | Polish (`pl`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/nl.ts` | Dutch (`nl`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/ru.ts` | Russian (`ru`) locale overlay (`DeepPartial` of English) |
| `client/discovery/i18n/types.ts` | `DISCOVER_LOCALES` list for the language menu |
| `client/discovery/i18n/index.tsx` | Catalog registry + `t('dot.path')` helper |

Much of the wider portal (Scanner, Settings, admin dashboards, etc.) is still English-only. Prefer extending these catalogs and wiring `useDiscoverI18n()` / `t('…')` where new chrome is needed, rather than inventing a second system.

### Improve an existing language

1. Fork / clone the repo and open a branch.
2. Diff `en.ts` against your locale file (e.g. `fr.ts`).
3. Add or fix strings using the **same nested keys** as English.
4. Keep placeholders intact: `{count}`, `{days}`, `{name}`, `{pct}`, `{time}`, etc.
5. For plurals, add a sibling key with `_plural` when English has one (e.g. `episodeCount` / `episodeCount_plural`). The translator picks `_plural` when `|count| !== 1`.
6. Run `npm run build` (or at least `npm run build:js`) and spot-check Discover + Home Wrap-Up with that language selected.
7. Open a pull request — partial passes are welcome.

You do not need a translation platform. Edited `.ts` catalogs + a PR is enough. If you cannot open a PR, paste suggested strings (key → translation) in an issue or Discord and maintainers can land them.

For the full localization workflow and current project coverage, see the [Localization Guide](translations.md) and [Localization Status](translation-status.md).

### Add a new language

1. Add a locale overlay such as `it.ts` under `client/discovery/i18n/` and translate the strings (you may copy an existing overlay or start from a minimal subset — English fills gaps).
2. Register the locale code in `DISCOVER_LOCALES` inside `types.ts` (`code`, `label`, `nativeLabel`).
3. Import the catalog in `index.tsx` and add it to the `catalogs` map.
4. Build and verify the new option appears in the language menu and Discover metadata requests send the right locale header.

### Conventions

- Prefer natural UI phrasing over word-for-word English.
- Do not translate product names unless there is an established local form (e.g. leave “Discover”, “Plex”, “Seerr” as-is when that reads better).
- Do not change key names in locale files — only values.
- When adding new English UI chrome, add the key to `en.ts` first, then optionally seed other locales in the same PR.

## Pull Request Checklist

- Keep runtime secrets out of git.
- Avoid committing generated runtime data from `config/` or `backup/`.
- Run the relevant build command before opening a pull request.
- Update docs when behavior, setup, configuration, or deployment changes.
- Add focused tests or manual verification notes when touching shared flows.
- For translation PRs: keep placeholders, match `en.ts` keys, and note which screens you checked.

## Release Notes

User-facing changes belong in `CHANGELOG.md`. Merges to `main` are versioned by [Release Please](https://github.com/googleapis/release-please) from **Conventional Commits** on the PR title / squash commit.

### Commit messages (release-please)

Use a type and optional scope, then a clear summary:

```text
feat(spotify-sync): add Compose supervisord mount for portal-managed sync schedule
fix(docker): mount spotify-to-plex env_file from portal-generated config
```

| Type | When |
| --- | --- |
| `feat` | New capability |
| `fix` | Bug fix |
| `perf` | Performance |
| `docs` | Docs only |
| `chore` | Tooling, deps, no user impact |

**Docker / Compose wording** (for changelog and operator-facing text):

| Prefer | Instead of |
| --- | --- |
| `spotify-to-plex` **container** or **Compose service** | sidecar |
| **image** (`jjdenhertog/spotify-to-plex`) | app binary |
| **env_file** / `config/spotify-to-plex.env` | host `.env` credentials |
| **bind mount** / **volume** (`config/spotify-to-plex`) | config folder (vague) |
| **supervisor** `sync-scheduler` process | sidecar cron (in logs) |
| **restart the container** | restart the sidecar |
| **Docker network** service URL (`http://spotify-to-plex:9030`) | internal URL (in docs, clarify) |

Internal config keys (e.g. `spotifyToPlexScheduleMode: sidecar`) stay as-is for compatibility; user-facing copy and commit summaries should use the terms above.

Scopes that match the repo: `spotify-sync`, `docker`, `compose`, `collexions`, `settings`, `ui`, etc.

