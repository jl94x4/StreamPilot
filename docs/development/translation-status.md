# Localization Status

This is a living planning document. Re-audit the current `nightly` branch before implementing localization work.

This file tracks UI i18n wiring and known remaining localization work. It does not guarantee translation completeness for every individual locale.

The supported UI locale set is `en`, `fr`, `de`, `es`, `pt-BR`, `it`, `ja`, `pl`, `nl`, and `ru`. English is the source catalog; French is currently complete, German and Spanish are partial overlays, and the six newly registered locales are partial overlays that fall back to English.

## Status Meaning

| State | Meaning |
| --- | --- |
| i18n-enabled | The UI area is wired into an i18n system. This does not mean every locale is fully translated. |
| Partial | Some UI chrome is i18n-enabled, but notable rendered UI remains hardcoded or unaudited. |
| Mostly hardcoded | Most rendered UI chrome is not yet wired into the localization system. |
| Maintainer decision | Localization may need a namespace, architecture, behavior, or scope decision before implementation. |

## Current i18n Coverage

This table describes broad UI i18n wiring and known remaining work. It does not claim backend messages, user data, external metadata, configured values, or provider content are localized. The Maintenance/Cleaner rules workflow is covered in a focused batch; the wider dashboard remains Partial.

| Area | State |
| --- | --- |
| Primary portal navigation | i18n-enabled |
| Discover / Request member UI | i18n-enabled |
| Home / Wrap-Up | i18n-enabled |
| In-app notification chrome | i18n-enabled |
| Achievements | i18n-enabled (feature-local catalog) |
| Status Monitor settings | i18n-enabled |
| Achievements settings | i18n-enabled |
| Invites settings | i18n-enabled |
| Settings navigation / tabs | i18n-enabled |
| Overlays dashboard | i18n-enabled |
| Downloads page | i18n-enabled |
| Media Stack Calendar | i18n-enabled |
| Status page | i18n-enabled |
| Support tickets | i18n-enabled |
| Wider Settings | Partial |
| Scanner | i18n-enabled |
| ColleXions | Partial |
| Media Automation | Partial |
| Poster Sets | Partial |
| Library Upgrader | Partial |
| Requests admin UI | Partial |
| Maintenance / Cleaner | i18n-enabled |
| About | i18n-enabled |
| Logs | i18n-enabled |
| Setup/admin utility areas | Mostly hardcoded |

## Current Recommended Small Batches

These batches are planning guidance only. Recalculate collision risk from recent `nightly` history before starting work.

| Batch | Approximate scope | Recommended namespace | Size | Architecture risk |
| --- | --- | --- | --- | --- |
| Settings navigation / tabs | Settings navigation, tab labels, and navigation-order settings chrome | `settings.navigation.*` | Medium | Medium |
| Major primary pages / recurring actions | High-traffic page headings, buttons, empty states, and repeated action chrome | Use existing feature namespaces where available | Medium | Medium |
| Feature-specific settings wrappers and secondary modules | Smaller settings wrappers such as Overlays, Poster Sets, Scanner, ColleXions, and Library Upgrader | `settings.overlays.*`, `settings.posterSets.*`, `settings.scanner.*`, `settings.collexions.*`, `settings.upgrader.*` | Small / Medium | Low / Medium |

## Larger Future Areas

Large modules should be decomposed into reviewable sub-batches rather than one huge translation PR.

Future candidates include:

- Scanner dashboard
- ColleXions module
- Media Automation module
- Poster Sets module
- Library Upgrader module
- Requests admin UI
- Maintenance / Cleaner
- About / Logs
- setup/admin utility areas

## Architecture / Maintainer Decision Backlog

These areas should be re-audited and may need maintainer confirmation before localization:

- Settings search/index metadata
- setup wizard flows where localization may require broader structural decisions

Treat these as candidates for review, not permanent blockers.

## Locale-Specific Status

French source/catalog parity was healthy at the latest global audit. No known missing keys, extra keys, or placeholder mismatches were found at that time.

German, Spanish, and other locales must be audited independently unless their current completeness has been verified against the latest source catalog.

## Updating This File

Update this file when a localization PR materially changes:

- module i18n coverage
- roadmap status
- architecture decision status

Do not use this document as a changelog. Do not include PR history, personal notes, local paths, branch or stash history, exact temporary SHAs, exact volatile catalog counts, or detailed audit history.
