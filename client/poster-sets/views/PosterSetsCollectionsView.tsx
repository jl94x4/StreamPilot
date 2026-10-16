import React, { useMemo, useState } from 'react';
import {
    Layers,
    Loader2,
    RefreshCw,
    Search,
    X,
} from 'lucide-react';
import { PosterSetsGridSizeSlider } from '../shared';
import { PosterSetsCreatorsPanel } from '../PosterSetsCreatorsPanel';
import { SetInspector, SetInspectorThumbStrip } from '../SetInspector';
import { inferPreviewMediaType, relatedSetKey } from '../posterSetsDashboardUtils';
import {
    BrowseSetCard,
    PreviewAssetGallery,
    RelatedSetsRail,
    buttonClass,
    bulkEntryFromSet,
    cardClass,
    fieldClass,
    nativeSearchCancelHiddenClass,
    isTitleCardSet,
    listToText,
    sectionBodyClass,
    sectionTitleClass,
    textToList,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

export const PosterSetsCollectionsView: React.FC = () => {
    const {
        tab,
        busy,
        collectionSets,
        collectionGroups,
        collectionsLoading,
        collectionsError,
        collectionsNeedsFollowers,
        loadCollections,
        gridSize,
        setGridSize,
        posterGridClass,
        posterGridStyle,
        selectedBulkSets,
        toggleBulkSet,
        selectBrowseSets,
        selectedSearchSet,
        expandSetInline,
        openCreatorCatalog,
        whitelistText,
        setWhitelistText,
        setConfigDraft,
        saveCreatorsConfig,
        toast,
        inspectorOpen,
        previewPanelRef,
        previewHeaderLabel,
        readyToApply,
        matchedAssetCount,
        preview,
        selectedAssetIds,
        setSelectedAssetIds,
        titleCardsOnly,
        showInspectorAssets,
        setShowInspectorAssets,
        applyMatched,
        runApply,
        queueEntireWithConfirm,
        applyUnmatched,
        applyNewSinceWatch,
        selectPreviewAssets,
        collapseSetInspector,
        matchedThumbStrip,
        previewSections,
        toggleAsset,
        relatedSets,
        relatedSetsLoading,
        goToPrimaryTab,
    } = usePosterSetsDashboard();

    const [query, setQuery] = useState('');
    const needle = query.trim().toLowerCase();

    const filteredGroups = useMemo(() => {
        if (!needle) return collectionGroups;
        return collectionGroups
            .map((group) => ({
                ...group,
                sets: group.sets.filter((set) => {
                    const title = String(set.title || '').toLowerCase();
                    const user = String(set.user || '').toLowerCase();
                    return title.includes(needle) || user.includes(needle);
                }),
            }))
            .filter((group) => group.sets.length > 0);
    }, [collectionGroups, needle]);

    const visibleCount = filteredGroups.reduce((sum, group) => sum + group.sets.length, 0);

    if (tab !== 'collections') return null;

    if (inspectorOpen) {
        return (
            <section className={`${cardClass} space-y-6 p-4 sm:p-5`}>
                <SetInspector
                    panelRef={previewPanelRef}
                    set={selectedSearchSet}
                    headerLabel={previewHeaderLabel}
                    loading={busy === 'preview'}
                    ready={readyToApply}
                    matchedCount={matchedAssetCount}
                    unmatchedCount={preview?.unmatched ?? 0}
                    totalCount={preview?.total || 0}
                    selectedCount={selectedAssetIds.length}
                    titleCardsOnly={titleCardsOnly}
                    showAssets={showInspectorAssets}
                    busy={busy}
                    assets={preview?.assets}
                    onChangeSelectedIds={setSelectedAssetIds}
                    onToggleShowAssets={() => setShowInspectorAssets((value) => !value)}
                    onQueueMatched={() => void applyMatched()}
                    onQueueSelected={() => void runApply(true)}
                    onQueueEntire={() => void queueEntireWithConfirm()}
                    onQueueUnmatched={() => void applyUnmatched()}
                    onQueueNewSinceWatch={() => void applyNewSinceWatch()}
                    onSelectMatched={() => selectPreviewAssets('matched')}
                    onSelectAll={() => selectPreviewAssets('all')}
                    onClearSelection={() => selectPreviewAssets('none')}
                    onClose={() => collapseSetInspector({ scrollToSets: false })}
                    closeLabel="Back"
                    thumbStrip={(
                        <SetInspectorThumbStrip
                            thumbs={matchedThumbStrip}
                            layout={titleCardsOnly || isTitleCardSet(selectedSearchSet) ? 'landscape' : 'poster'}
                            setUrl={selectedSearchSet?.url}
                            provider={selectedSearchSet?.provider}
                        />
                    )}
                    gallery={(
                        <PreviewAssetGallery
                            sections={previewSections}
                            selectedAssetIds={selectedAssetIds}
                            onToggle={toggleAsset}
                        />
                    )}
                    relatedRail={(
                        <RelatedSetsRail
                            sets={relatedSets}
                            loading={relatedSetsLoading}
                            mediaLabel={inferPreviewMediaType(preview) === 'show' ? 'show' : 'movie'}
                            disabled={busy !== null}
                            onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: false, skipUrl: true })}
                            onOpenCreator={openCreatorCatalog}
                        />
                    )}
                />
            </section>
        );
    }

    return (
        <section className={`${cardClass} space-y-6 p-4 sm:p-5`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 max-w-3xl">
                    <h2 className={sectionTitleClass}>Collection Sets</h2>
                    <p className={sectionBodyClass}>
                        Boxsets and collection packs from creators you follow — same-style film collections you can preview and apply in bulk.
                        Followed creators&apos; collection sets are cached automatically.
                    </p>
                    {collectionsError ? (
                        <p className="mt-2 text-xs text-amber-200">{collectionsError}</p>
                    ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <PosterSetsGridSizeSlider
                        value={gridSize}
                        onChange={setGridSize}
                        className="w-full min-w-[140px] sm:w-auto"
                    />
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={collectionsLoading || busy !== null}
                        onClick={() => void loadCollections({ refresh: true })}
                    >
                        {collectionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                    </button>
                </div>
            </div>

            <PosterSetsCreatorsPanel
                collapsible
                creators={textToList(whitelistText).map((item) => item.replace(/^@+/, ''))}
                busy={busy}
                onChange={(next) => {
                    setWhitelistText(listToText(next));
                    setConfigDraft((prev) => ({ ...prev, creatorWhitelist: next }));
                }}
                onSave={saveCreatorsConfig}
                onOpenCreator={openCreatorCatalog}
                toast={toast}
            />

            {collectionsNeedsFollowers ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                    <Layers className="h-8 w-8 text-muted" />
                    <p className="text-sm text-muted">
                        Follow creators to see their collection and boxset packs here.
                    </p>
                    <button
                        type="button"
                        className={buttonClass}
                        onClick={() => goToPrimaryTab('discover')}
                    >
                        Browse creators
                    </button>
                </div>
            ) : (
                <>
                    <div className="relative min-w-0">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <input
                            type="text"
                            inputMode="search"
                            enterKeyHint="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter collections by title or creator…"
                            className={`${fieldClass} ${nativeSearchCancelHiddenClass} w-full pl-10 ${query.trim() ? 'pr-11' : ''}`}
                        />
                        {query.trim() ? (
                            <button
                                type="button"
                                className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-white/10 hover:text-text"
                                aria-label="Clear filter"
                                onClick={() => setQuery('')}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                        <span>
                            {visibleCount}
                            {visibleCount !== collectionSets.length ? ` of ${collectionSets.length}` : ''}
                            {' '}collection set{visibleCount === 1 ? '' : 's'}
                            {collectionsLoading ? ' · loading…' : ''}
                        </span>
                        {filteredGroups.length ? (
                            <button
                                type="button"
                                className="font-semibold text-plex hover:underline"
                                disabled={busy !== null}
                                onClick={() => selectBrowseSets(filteredGroups.flatMap((group) => group.sets))}
                            >
                                Select all visible
                            </button>
                        ) : null}
                    </div>

                    {collectionsLoading && !collectionSets.length ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading collection sets from creators you follow…
                        </div>
                    ) : null}

                    {!collectionsLoading && !collectionSets.length && !collectionsNeedsFollowers ? (
                        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
                            No collection or boxset packs found for the creators you follow yet.
                        </p>
                    ) : null}

                    {needle && !filteredGroups.length && collectionSets.length ? (
                        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted">
                            No collection sets match that filter.
                        </p>
                    ) : null}

                    {filteredGroups.map((group) => (
                        <div key={group.user} className="space-y-2.5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <button
                                    type="button"
                                    className="group inline-flex min-w-0 items-center gap-2 text-left"
                                    onClick={() => openCreatorCatalog(group.user)}
                                >
                                    <h3 className="text-sm font-bold text-text group-hover:text-plex sm:text-base">
                                        @{group.user}
                                    </h3>
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-plex/80 group-hover:underline">
                                        All sets
                                    </span>
                                </button>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] text-muted">{group.sets.length}</span>
                                    <button
                                        type="button"
                                        className="text-[11px] font-semibold text-plex hover:underline"
                                        disabled={busy !== null}
                                        onClick={() => selectBrowseSets(group.sets)}
                                    >
                                        Select row
                                    </button>
                                </div>
                            </div>
                            <div className={posterGridClass} style={posterGridStyle}>
                                {group.sets.map((set) => (
                                    <BrowseSetCard
                                        key={`${set.provider}-${set.setId}`}
                                        set={set}
                                        disabled={busy !== null}
                                        bulkSelected={Boolean(selectedBulkSets[set.url])}
                                        expanded={Boolean(selectedSearchSet && relatedSetKey(selectedSearchSet) === relatedSetKey(set))}
                                        onToggleBulk={() => toggleBulkSet(bulkEntryFromSet(set))}
                                        onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: true, skipUrl: true })}
                                        onOpenCreator={openCreatorCatalog}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </>
            )}
        </section>
    );
};
