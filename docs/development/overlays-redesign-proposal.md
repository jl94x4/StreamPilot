# Overlays UX Redesign Proposal

*StreamPilot — Overlays section. Prepared from a read-through of `client/overlays/` (OverlaysDashboard.tsx, PlacementEditor.tsx, OverlayJobCard.tsx, api.ts) and the `overlays/` worker backend, August 2026.*

## Why it feels overwhelming

The complaints you're hearing line up exactly with what's in the code, so this isn't a vague "make it nicer" problem — it's a specific structural one. `OverlaysDashboard.tsx` is a single 4,684-line component holding 40 pieces of state and driving 387 distinct pieces of UI copy. Almost all of that lives on one tab, "Home," as four stacked accordion cards: Banners (core), Recently Added, Media/Layer, and Collection Badges. The Media/Layer card alone hides about twenty independent overlay families — resolution, HDR, edition, audio codec, video format, status, network, streaming, ratings, content rating, ribbon, aspect, versions, language count, language flags, runtimes, direct play, episode info, media stinger, plus a Kometa labelling toggle — all inside one expand/collapse panel with no sub-grouping. A fifth, deeper layer of settings ("Advanced") is hidden behind a "More settings" link on the same tab. Placement (dragging a badge into position) lives on a completely separate tab and works against nine abstract "kinds" (show, season, episode, recently, media, status, ratings, network, custom_collection) that aren't visibly tied back to the toggle that turned each one on. Running anything means finding the right one of four Save buttons and four Run buttons, each scoped to a different bundle, and then switching to a fifth tab, Activity, to see whether it worked.

None of that is a reflection of weak functionality — the feature is genuinely deep, and that depth is worth keeping. The problem is that the interface exposes the backend's internal grouping (which overlays happen to run in the same worker "bundle") as if it were the user's mental model, instead of organizing around what someone is actually trying to do: turn a type of badge on, see what it'll look like, put it where they want it, and get it onto their posters.

## Root causes, in plain terms

Four things compound on each other. First, there's no grouping by intent — twenty unrelated toggles sit in one flat list, so "do I want ratings badges" requires scanning past resolution, audio codec, and ribbon settings to find it. Second, the same action (turn something on, save it, run it) is duplicated four times with subtly different scope, and the labels for those scopes ("Banners (core)" vs "Media/Layer") don't map to any language a user would use to describe what they want. Third, the five tabs split one continuous task — configure, preview, position, apply, confirm — across five separate places with no thread connecting them, so a user has to already understand the system's internal architecture to know that positioning a badge happens somewhere else entirely from turning it on. Fourth, there's no on-ramp: a brand-new user is handed the exact same twenty-toggle surface as someone who wants to hand-tune every badge family, with no preset or "just get me a sensible result" path.

The badges (collection rule) flow is worth calling out as the one part of Overlays that already gets this right: it's a step-by-step wizard (library → collection → badge → name) rather than a wall of settings. That pattern, not the accordion pattern, is the one worth generalizing.

## Design principles for the redesign

The redesign should organize the screen around the handful of things a person is actually deciding, not around which Python module happens to render which badge. Configuration should default to a small, visual, opinionated set of choices, with the full depth of options one click away rather than open by default — so a first-time user sees maybe six or seven clearly-named overlay categories with a screenshot of what each looks like, not twenty raw toggles. There should be exactly one way to apply changes to Plex, not four differently-scoped Run buttons; the system can still batch work into whatever bundles are efficient behind the scenes, but the user should only ever see "Preview" and "Apply to Plex." Positioning a badge belongs next to the toggle that turns it on, with a live preview, not on a separate tab addressed by an abstract identifier. And status — is something running, did the last run succeed, what's currently live on Plex — should be visible everywhere, not something you have to navigate away to check.

## Proposed information architecture

Rather than five tabs organized around implementation detail, Overlays would have three: **Overview**, **Configure**, and **Activity**.

Overview replaces the current Home tab's stack of accordions. It shows, at a glance, what's currently applied to the library, grouped into the same handful of categories used everywhere else in the redesign (see the table below), each with a status chip (on/off, item count, last applied time) and a thumbnail of what it looks like on a real poster. There's one prominent "Apply to Plex" action if anything is pending, and a persistent status strip ("Running now…" / "Last applied 6h ago") that stays visible across all three tabs, so a user never has to hunt for Activity just to know whether something finished.

Configure is where the twenty-plus toggles currently crammed into the Media/Layer card live, but reorganized into the category groups below, presented as a gallery: each category shows a visual sample, a plain-language description, an on/off switch, and a "Customize" expander for the handful of people who want to tune windows, presets, or styles for that specific category. Placement moves here too — when a category is expanded, its position-on-poster control sits directly underneath its other settings, using the same drag-to-place UI that already exists in PlacementEditor.tsx, so "turn it on" and "put it where I want it" happen in one continuous flow instead of two disconnected tabs. The Collection Badges wizard slots in as one of these categories, unchanged, since it's already the right pattern.

Activity keeps its current job, but becomes purely a history/queue view — what ran, when, what's queued, what to cancel — since day-to-day status now lives in the persistent strip rather than requiring a tab switch.

The table below maps today's flat list of ~23 toggle families into the proposed groupings. This is a starting point for you to react to, not a final taxonomy — the exact split is worth validating against how your users actually talk about these features.

| Proposed category | What it currently is |
|---|---|
| New & Returning | New Season, New Episode, Live, Skip-on-binge, TMDB air-date fallback (today's "Banners (core)" card) |
| Recently Added | Recently Added banners and window/schedule |
| Top 10 | Top 10 corner badge |
| Quality & Format | Resolution, edition, audio codec, video format, aspect, versions, direct play |
| Ratings & Reviews | Ratings, content rating, ribbon (awards) |
| Availability | Status, streaming providers, network logo |
| Language & Runtime | Language count, language flags, runtimes, episode info |
| Bonus Content | Media stinger |
| Collection Badges | The existing library → collection → badge → name wizard, unchanged |

Advanced settings — schedule hours per category, deny keys, worker/label internals, import log, "reset all" — stay demoted into a single, clearly optional Advanced panel reachable from Overview, exactly as the "More settings" panel works today. The goal isn't to remove that depth, only to stop it from being the first thing a new user has to wade through.

## What the flow looks like before and after

Today, turning on ratings badges and getting them onto Plex means: open Home, scroll past the Banners and Recently Added cards to find Media/Layer, expand it, find "Ratings overlay enabled" among nineteen siblings, toggle it, scroll to that card's own Save button, click it, then click that card's own Run button (or realize you meant to Preview first), then switch to the Look tab, find "ratings" in a placement dropdown that isn't obviously related to what you just did, drag it into position, save placement separately, switch to Activity to confirm the run finished, and switch back to Home to check whether it actually applied.

Under the proposed structure: open Configure, find "Ratings & Reviews" in a short visual list of eight categories, switch it on, optionally expand "Customize" to drag the badge into position with a live preview right there, click the single Preview action to see it on real posters, click Apply to Plex. The status strip shows progress, and Overview reflects the new state as soon as it's done. Same underlying capability, roughly a third of the navigation.

## Implementation approach

Because the entire feature currently lives in one 4,684-line file, this redesign is also a good forcing function to split `OverlaysDashboard.tsx` into feature-scoped components (an Overview component, a Configure component per category group, the existing PlacementEditor and OverlayJobCard reused rather than duplicated, an Activity component) — that decomposition makes the new IA easier to build and far easier to maintain afterward, independent of the UX benefit. None of this requires backend or config-schema changes; the existing `/api/overlays` endpoints, the bundle-based worker jobs, and the `config/overlays/config.json` shape can stay exactly as they are — this is purely a presentation-layer restructuring that reads and writes the same data through a friendlier surface.

A low-risk build order would be: ship the new Overview screen first, since it's additive and doesn't touch existing save/run logic; then build the Configure gallery and category groupings while temporarily keeping the old accordions reachable for verification; then fold Placement into Configure; then collapse the four Save/Run pairs into the single Preview/Apply pattern (this is the riskiest step, since it changes how the four backend bundles get triggered, so it's worth doing last and testing each category's run path individually); then move Activity's status into the persistent strip. Each stage is independently shippable and reviewable, which matters given how much surface area this component covers.

## Decisions worth making before mockups or build work start

A few things are genuinely yours to call, since they shape the design rather than being fixable later: whether the eight-category grouping above matches how you and your users actually think about these overlays, or whether some should merge or split differently; whether schedule timing should stay per-category (as it roughly is today, one schedule per bundle) or become one global schedule with per-category overrides for power users; and whether Configure should open with an opinionated preset (e.g., "Just show what's new" enabling only New & Returning and Recently Added) for brand-new setups, or start with everything off and let the user opt in category by category.
