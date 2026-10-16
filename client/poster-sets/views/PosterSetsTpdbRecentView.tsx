import React from 'react';
import {
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Loader2,
    RefreshCw,
    Sparkles,
} from 'lucide-react';
import { PosterSetsGridSizeSlider } from '../shared';
import { CustomSelect } from '../../shared/ui';
import { SetInspector, SetInspectorThumbStrip } from '../SetInspector';
import { inferPreviewMediaType } from '../posterSetsDashboardUtils';
import {
    BrowseSetCard,
    PreviewAssetGallery,
    RelatedSetsRail,
    SEARCH_SETS_PAGE_SIZE_OPTIONS,
    bulkEntryFromSet,
    buttonClass,
    isTitleCardSet,
    normalizeSearchSetsPageSize,
    sectionBodyClass,
    sectionTitleClass,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

export const PosterSetsTpdbRecentView: React.FC = () => {
    const {
        tab,
        busy,
        setUrl,
        runPreview,
        configDraft,
        setSelectedSearchSet,
        setSearchSetsPage,
        searchSets,
        searchMode,
        searchContext,
        catalogError,
        searchLoadingMore,
        searchSetsPage,
        searchSetsPageCount,
        searchSetsPageSize,
        setSearchSetsPageSize,
        pagedSearchSets,
        rankedSearchSets,
        selectedSearchSet,
        inspectorOpen,
        preview,
        previewHeaderLabel,
        readyToApply,
        matchedAssetCount,
        selectedAssetIds,
        setSelectedAssetIds,
        selectedBulkSets,
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
        expandSetInline,
        openCreatorCatalog,
        openTpdbRecentCatalog,
        toggleBulkSet,
        selectBrowseSets,
        clearBulkSelection,
        selectedBulkCount,
        previewPanelRef,
        searchSetsSectionRef,
        gridSize,
        setGridSize,
        posterGridClass,
        posterGridStyle,
        titleCardGridStyle,
        searchSetsUseTitleCardGrid,
    } = usePosterSetsDashboard();

    if (tab !== 'tpdb') return null;

    const followedHandles = (configDraft.creatorWhitelist || [])
        .map((name) => String(name || '').replace(/^@+/, '').trim())
        .filter(Boolean);
    const followingSiteHref = followedHandles[0]
        ? `https://theposterdb.com/user/${encodeURIComponent(followedHandles[0])}`
        : 'https://theposterdb.com/';

    const catalogGridStyle = searchSetsUseTitleCardGrid ? titleCardGridStyle : posterGridStyle;
    const catalogBusy = busy !== null && busy !== 'preview' && busy !== 'search';

    if (inspectorOpen) {
        return (
            <section ref={searchSetsSectionRef} className="min-w-0 space-y-5 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xl">
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
                    onToggleShowAssets={() => setShowInspectorAssets((value: boolean) => !value)}
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
                            onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: false })}
                            onOpenCreator={(user) => openCreatorCatalog(user, { locationTab: 'apply' })}
                        />
                    )}
                />
            </section>
        );
    }

    return (
        <section ref={searchSetsSectionRef} className="min-w-0 space-y-5 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 max-w-3xl">
                    <div className="flex items-center gap-2 text-plex">
                        <Sparkles className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-wide">ThePosterDB</span>
                    </div>
                    <h2 className={`mt-1 ${sectionTitleClass}`}>
                        {searchContext || (searchMode === 'feed' ? 'Following' : 'Recently added')}
                    </h2>
                    <p className={sectionBodyClass}>
                        {searchMode === 'feed'
                            ? 'Sets from Creators you follow in Poster Sets settings — public TPDB profiles, no ThePosterDB login.'
                            : 'Newest sets from theposterdb.com/recent, loaded like a creator catalog. Tick full sets, then Queue & watch.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={`${buttonClass} ${searchMode !== 'feed' ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                            disabled={busy !== null && busy !== 'search'}
                            onClick={() => openTpdbRecentCatalog({ kind: 'recent', refresh: searchMode === 'feed' })}
                        >
                            Everyone
                        </button>
                        <button
                            type="button"
                            className={`${buttonClass} ${searchMode === 'feed' ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                            disabled={busy !== null && busy !== 'search'}
                            onClick={() => openTpdbRecentCatalog({ kind: 'feed', refresh: searchMode !== 'feed' })}
                        >
                            Following
                        </button>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                        {searchSets.length
                            ? `${searchSets.length} set${searchSets.length === 1 ? '' : 's'} loaded`
                            : catalogError
                                ? 'Couldn’t load this feed'
                                : (busy === 'search' || searchLoadingMore)
                                    ? 'Loading sets…'
                                    : 'No sets yet'}
                        {searchSets.length > searchSetsPageSize
                            ? ` · page ${Math.min(searchSetsPage, searchSetsPageCount)} / ${searchSetsPageCount}`
                            : ''}
                        {searchLoadingMore ? ' · loading more…' : ''}
                        {selectedBulkCount ? ` · ${selectedBulkCount} selected` : ''}
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <PosterSetsGridSizeSlider
                        value={gridSize}
                        onChange={setGridSize}
                        className="w-full min-w-[140px] sm:w-auto"
                    />
                    <CustomSelect
                        value={String(searchSetsPageSize)}
                        onChange={(value) => {
                            setSearchSetsPageSize(normalizeSearchSetsPageSize(value));
                            setSearchSetsPage(1);
                        }}
                        options={[...SEARCH_SETS_PAGE_SIZE_OPTIONS]}
                        className="w-full min-w-[140px] sm:w-auto"
                        compact
                    />
                    {searchSetsPageCount > 1 ? (
                        <>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={catalogBusy || searchSetsPage <= 1}
                                onClick={() => setSearchSetsPage((page: number) => Math.max(1, page - 1))}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                Prev
                            </button>
                            <span className="text-xs text-muted">
                                {Math.min(searchSetsPage, searchSetsPageCount)} / {searchSetsPageCount}
                            </span>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={catalogBusy || searchSetsPage >= searchSetsPageCount}
                                onClick={() => setSearchSetsPage((page: number) => Math.min(searchSetsPageCount, page + 1))}
                            >
                                Next
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </>
                    ) : null}
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={busy !== null && busy !== 'search'}
                        onClick={() => openTpdbRecentCatalog({
                            refresh: true,
                            kind: searchMode === 'feed' ? 'feed' : 'recent',
                        })}
                    >
                        {busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                    </button>
                    <a
                        href={searchMode === 'feed' ? followingSiteHref : 'https://theposterdb.com/recent'}
                        target="_blank"
                        rel="noreferrer"
                        className={`${buttonClass} no-underline`}
                    >
                        <ExternalLink className="h-4 w-4" />
                        Open site
                    </a>
                </div>
            </div>

            <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={!pagedSearchSets.length}
                            onClick={() => selectBrowseSets(pagedSearchSets)}
                        >
                            Select this page
                        </button>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={!rankedSearchSets.length}
                            onClick={() => selectBrowseSets(rankedSearchSets)}
                        >
                            Select all loaded
                        </button>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={!selectedBulkCount}
                            onClick={clearBulkSelection}
                        >
                            Clear selection
                        </button>
                    </div>
                    <p className="text-xs text-muted">
                        Each card is a full set, not just the cover. Queue & watch applies every poster in the selected sets.
                    </p>
                    {busy === 'search' && !searchSets.length ? (
                        <div className="flex items-center gap-2 text-sm text-muted">
                            <Loader2 className="h-4 w-4 animate-spin text-plex" />
                            Loading first pages…
                        </div>
                    ) : catalogError && !searchSets.length ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
                            {catalogError}
                        </div>
                    ) : (
                        <div className={posterGridClass} style={catalogGridStyle}>
                            {pagedSearchSets.map((set) => (
                                <BrowseSetCard
                                    key={`${set.provider}-${set.setId}-${set.url}`}
                                    set={set}
                                    disabled={catalogBusy}
                                    bulkSelected={Boolean(selectedBulkSets[set.url])}
                                    onToggleBulk={() => toggleBulkSet(bulkEntryFromSet(set))}
                                    onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: true })}
                                    onOpenCreator={(user) => openCreatorCatalog(user, { locationTab: 'apply' })}
                                />
                            ))}
                        </div>
                    )}
                </div>
        </section>
    );
};
