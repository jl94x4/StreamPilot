import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ClipboardPaste,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Image as ImageIcon,
    Loader2,
    Save,
    Sparkles,
} from 'lucide-react';
import { PosterSetsGridSizeSlider } from '../shared';
import { CustomSelect } from '../../shared/ui';
import { posterSetsApi } from '../api';
import { SetInspector, SetInspectorThumbStrip } from '../SetInspector';
import { inferPreviewMediaType } from '../posterSetsDashboardUtils';
import {
    BrowseSetCard,
    PreviewAssetGallery,
    RelatedSetsRail,
    StatusPill,
    SEARCH_SETS_PAGE_SIZE_OPTIONS,
    bulkEntryFromSet,
    buttonClass,
    fieldClass,
    isTitleCardSet,
    jobErrorTextClass,
    normalizeSearchSetsPageSize,
    parseTpdbUserHandle,
    isTpdbRecentUrl,
    isTpdbFeedUrl,
    isMediuxEnabled,
    isTpdbEnabled,
    primaryButtonClass,
    sectionBodyClass,
    sectionTitleClass,
} from '../shared';
import { usePosterSetsDashboard } from '../PosterSetsDashboardContext';

const isTpdbPostersUrl = (value: string) => /theposterdb\.com\/posters\//i.test(value);

export const PosterSetsPasteView: React.FC = () => {
    const {
        toast,
        tab,
        setTab,
        busy,
        url,
        setUrl,
        findProvider,
        setFindProvider,
        findId,
        setFindId,
        bulkText,
        setBulkText,
        configDraft,
        queuePaused,
        activeJob,
        jobLogs,
        useFindId,
        runBulk,
        runPreview,
        pushPosterLocation,
        setSelectedSearchSet,
        setShowInspectorAssets,
        setSearchSets,
        setSearchContext,
        setSearchSetsPage,
        setSearchMode,
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
        gridSize,
        setGridSize,
        posterGridClass,
        posterGridStyle,
        titleCardGridStyle,
        searchSetsUseTitleCardGrid,
    } = usePosterSetsDashboard();
    const pasteSetsGridStyle = searchSetsUseTitleCardGrid ? titleCardGridStyle : posterGridStyle;
    const pageSizeSelect = (
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
    );

    const [titlePageLoading, setTitlePageLoading] = useState(false);
    const bulkLogRef = useRef<HTMLDivElement | null>(null);
    const bulkJob = activeJob?.type === 'bulk' ? activeJob : null;
    const bulkBusy = busy === 'bulk' || busy === 'bulk-file';
    const showBulkStatus = Boolean(bulkJob) || bulkBusy;
    const bulkSetCount = Number(bulkJob?.input?.count || bulkJob?.input?.lineCount || bulkJob?.input?.urls?.length || 0);
    const bulkUploaded = typeof bulkJob?.result?.uploaded === 'number'
        ? Number(bulkJob.result.uploaded)
        : (typeof bulkJob?.uploaded === 'number' ? bulkJob.uploaded : null);
    const bulkAttempted = typeof bulkJob?.result?.attempted === 'number'
        ? Number(bulkJob.result.attempted)
        : (typeof bulkJob?.attempted === 'number' ? bulkJob.attempted : null);
    const bulkJobsDone = typeof bulkJob?.result?.jobs === 'number' ? Number(bulkJob.result.jobs) : null;
    const bulkState = String(bulkJob?.state || (bulkBusy ? 'queued' : '')).toLowerCase();
    const bulkLogs = bulkJob ? jobLogs : [];
    const bulkCountLabel = bulkSetCount > 0
        ? `${bulkSetCount} URL${bulkSetCount === 1 ? '' : 's'}`
        : (bulkJob?.input?.fromFile ? String(bulkJob.input.file || 'bulk file') : 'bulk list');
    const bulkSourceLabel = bulkJob?.input?.fromFile
        ? ` from ${bulkJob.input.file || 'bulk_import.txt'}`
        : '';
    const bulkSummary = (() => {
        if (!bulkJob && bulkBusy) return 'Starting bulk import…';
        if (bulkState === 'running') {
            return bulkBusy
                ? `Applying ${bulkCountLabel}${bulkSourceLabel}… Also adding matching sets to Watching.`
                : `Applying ${bulkCountLabel}${bulkSourceLabel}…`;
        }
        if (bulkBusy && bulkState === 'queued') {
            return queuePaused
                ? `Queued ${bulkCountLabel}${bulkSourceLabel} — the queue is paused. Adding matching sets to Watching…`
                : `Queued ${bulkCountLabel}${bulkSourceLabel}. Adding matching sets to Watching…`;
        }
        if (bulkState === 'queued') {
            return queuePaused
                ? `Queued ${bulkCountLabel}${bulkSourceLabel} — waiting because the queue is paused.`
                : `Queued ${bulkCountLabel}${bulkSourceLabel} — waiting for a free worker.`;
        }
        if (bulkState === 'succeeded') {
            const uploaded = bulkUploaded ?? 0;
            const attemptedBit = bulkAttempted != null ? ` / ${bulkAttempted}` : '';
            const jobsBit = bulkJobsDone != null
                ? ` across ${bulkJobsDone} set${bulkJobsDone === 1 ? '' : 's'}`
                : '';
            return `Finished — uploaded ${uploaded}${attemptedBit} poster${uploaded === 1 ? '' : 's'}${jobsBit}.`;
        }
        if (bulkState === 'failed' || bulkState === 'cancelled' || bulkState === 'warning') {
            return bulkJob?.error || `Bulk ${bulkState}.`;
        }
        return `Bulk ${bulkCountLabel}${bulkSourceLabel}.`;
    })();

    useEffect(() => {
        const node = bulkLogRef.current;
        if (!node) return;
        node.scrollTop = node.scrollHeight;
    }, [bulkLogs, bulkJob?.id]);

    const stayOnPaste = useCallback((setUrlValue: string) => {
        setTab('paste');
        pushPosterLocation({
            tab: 'paste',
            rail: null,
            setUrl: setUrlValue,
            creator: null,
            titleCardsOnly: false,
        }, 'push');
    }, [pushPosterLocation, setTab]);

    const loadUrl = useCallback(async () => {
        const target = String(url || '').trim();
        if (!target) {
            toast('Paste a set URL first.', 'error');
            return;
        }

        const creatorHandle = parseTpdbUserHandle(target);
        if (isTpdbFeedUrl(target)) {
            openTpdbRecentCatalog({ locationTab: 'paste', kind: 'feed' });
            return;
        }
        if (isTpdbRecentUrl(target)) {
            openTpdbRecentCatalog({ locationTab: 'paste' });
            return;
        }
        if (creatorHandle) {
            openCreatorCatalog(creatorHandle, { locationTab: 'paste' });
            return;
        }

        if (isTpdbPostersUrl(target)) {
            setTitlePageLoading(true);
            setShowInspectorAssets(false);
            setSelectedSearchSet(null);
            setSearchMode('title');
            stayOnPaste(target);
            try {
                const response = await posterSetsApi.search({
                    provider: 'posterdb',
                    titleUrl: target,
                    limit: 500,
                });
                const sets = response.sets || [];
                setSearchSets(sets);
                setSearchSetsPage(1);
                setSearchContext(response.title || 'ThePosterDB title page');
                if (!sets.length) {
                    toast(response.partialErrors?.[0] || 'No sets on that ThePosterDB title page.', 'error');
                } else {
                    toast(`Found ${sets.length} set${sets.length === 1 ? '' : 's'} on that title page.`);
                }
            } catch (error) {
                toast(error instanceof Error ? error.message : 'Failed to load title page', 'error');
            } finally {
                setTitlePageLoading(false);
            }
            return;
        }

        setSelectedSearchSet({
            setId: '',
            title: target,
            url: target,
        });
        setShowInspectorAssets(false);
        setSearchSets([]);
        stayOnPaste(target);
        void runPreview(target, { titleCardsOnly: false, keepSearch: true });
    }, [
        url,
        toast,
        stayOnPaste,
        setShowInspectorAssets,
        setSelectedSearchSet,
        setSearchSets,
        setSearchSetsPage,
        setSearchContext,
        setSearchMode,
        openCreatorCatalog,
        openTpdbRecentCatalog,
        runPreview,
    ]);

    const loadSetId = useCallback(async () => {
        await useFindId(true, { locationTab: 'paste' });
    }, [useFindId]);

    if (tab !== 'paste') return null;

    if (inspectorOpen) {
        return (
            <div className="min-w-0 space-y-4">
                <section className="min-w-0 space-y-5 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xl">
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
                                onOpenCreator={(user) => openCreatorCatalog(user, { locationTab: 'paste' })}
                            />
                        )}
                    />
                </section>
            </div>
        );
    }

    return (
        <div className="min-w-0 space-y-4">
            <section className="min-w-0 space-y-5 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 max-w-3xl">
                        <div className="flex items-center gap-2 text-plex">
                            <ClipboardPaste className="h-4 w-4" />
                            <span className="text-xs font-bold uppercase tracking-wide">Paste / Import</span>
                        </div>
                        <h2 className={`mt-1 ${sectionTitleClass}`}>Load a set by URL or ID</h2>
                        <p className={sectionBodyClass}>
                            Paste a <code className="text-text">/set/…</code> or{' '}
                            <code className="text-text">/posters/…</code> URL, a creator{' '}
                            <code className="text-text">/user/…</code> page,{' '}
                            <code className="text-text">/recent</code>, or{' '}
                            <code className="text-text">/feed</code> to browse newly added ThePosterDB sets.
                        </p>
                    </div>
                    <a
                        href={findProvider === 'posterdb' ? 'https://theposterdb.com/' : 'https://mediux.pro/'}
                        target="_blank"
                        rel="noreferrer"
                        className={`${buttonClass} no-underline shrink-0`}
                    >
                        <ExternalLink className="h-4 w-4" />
                        Open {findProvider === 'posterdb' ? 'ThePosterDB' : 'MediUX'}
                    </a>
                </div>

                <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Provider</p>
                    <div className="flex flex-wrap gap-2">
                        {([
                            ...(isMediuxEnabled(configDraft) ? [['mediux', 'MediUX'] as const] : []),
                            ...(isTpdbEnabled(configDraft) ? [['posterdb', 'ThePosterDB'] as const] : []),
                        ]).map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                className={`${buttonClass} !py-1.5 text-xs ${findProvider === id ? 'border-plex/40 bg-plex/15 text-plex' : ''}`}
                                onClick={() => setFindProvider(id)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Set / poster ID</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                            className={fieldClass}
                            value={findId}
                            onChange={(event) => setFindId(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void loadSetId();
                                }
                            }}
                            placeholder={findProvider === 'mediux' ? 'Set ID e.g. 24522' : 'Set/poster ID or username e.g. fwlolx'}
                        />
                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void loadSetId()}>
                            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                            Load set
                        </button>
                    </div>
                </div>

                <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Full URL</p>
                    <input
                        className={fieldClass}
                        placeholder="https://mediux.pro/sets/… · https://theposterdb.com/set/… · /user/… · /recent · /feed · /posters/…"
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void loadUrl();
                            }
                        }}
                    />
                    <button
                        type="button"
                        className={primaryButtonClass}
                        disabled={busy !== null || titlePageLoading}
                        onClick={() => void loadUrl()}
                    >
                        {(busy === 'preview' || titlePageLoading)
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <ClipboardPaste className="h-4 w-4" />}
                        Load URL
                    </button>
                </div>

                {(searchMode === 'creator' || searchMode === 'recent' || searchMode === 'feed') && (searchSets.length > 0 || searchLoadingMore || busy === 'search' || Boolean(catalogError)) && !inspectorOpen ? (
                    <div className="space-y-3 border-t border-white/10 pt-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-text">
                                    Sets from {searchContext || (searchMode === 'feed'
                                        ? 'ThePosterDB following feed'
                                        : searchMode === 'recent' ? 'ThePosterDB recently added' : 'this creator')}
                                </h3>
                                <p className="mt-0.5 text-[11px] text-muted">
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
                                {pageSizeSelect}
                                {searchSetsPageCount > 1 ? (
                                    <>
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            disabled={(busy !== null && busy !== 'preview' && busy !== 'search') || searchSetsPage <= 1}
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
                                            disabled={(busy !== null && busy !== 'preview' && busy !== 'search') || searchSetsPage >= searchSetsPageCount}
                                            onClick={() => setSearchSetsPage((page: number) => Math.min(searchSetsPageCount, page + 1))}
                                        >
                                            Next
                                            <ChevronRight className="h-4 w-4" />
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        </div>
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
                            Each card is a full set, not just the cover you see. Tick the ones you want, then Queue & watch at the bottom to apply every poster in those sets.
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
                            <div className={posterGridClass} style={pasteSetsGridStyle}>
                                {pagedSearchSets.map((set) => (
                                    <BrowseSetCard
                                        key={`${set.provider}-${set.setId}-${set.url}`}
                                        set={set}
                                        disabled={busy !== null && busy !== 'preview' && busy !== 'search'}
                                        bulkSelected={Boolean(selectedBulkSets[set.url])}
                                        onToggleBulk={() => toggleBulkSet(bulkEntryFromSet(set))}
                                        onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: true })}
                                        onOpenCreator={(user) => openCreatorCatalog(user, { locationTab: 'paste' })}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}

                {searchMode !== 'creator' && searchMode !== 'recent' && searchMode !== 'feed' && searchSets.length > 0 && !inspectorOpen ? (
                    <div className="space-y-3 border-t border-white/10 pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-text">Sets from title page</h3>
                                <span className="text-[11px] text-muted">{searchSets.length} found</span>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <PosterSetsGridSizeSlider
                                    value={gridSize}
                                    onChange={setGridSize}
                                    className="w-full min-w-[140px] sm:w-auto"
                                />
                                {pageSizeSelect}
                            </div>
                        </div>
                        {searchSetsPageCount > 1 ? (
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy !== null || searchSetsPage <= 1}
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
                                    disabled={busy !== null || searchSetsPage >= searchSetsPageCount}
                                    onClick={() => setSearchSetsPage((page: number) => Math.min(searchSetsPageCount, page + 1))}
                                >
                                    Next
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        ) : null}
                        <div className={posterGridClass} style={pasteSetsGridStyle}>
                            {pagedSearchSets.map((set) => (
                                <BrowseSetCard
                                    key={`${set.provider}-${set.setId}-${set.url}`}
                                    set={set}
                                    disabled={busy !== null}
                                    bulkSelected={Boolean(selectedBulkSets[set.url])}
                                    onToggleBulk={() => toggleBulkSet(bulkEntryFromSet(set))}
                                    onOpen={(item) => void expandSetInline(item, { stayOnTab: true, toggle: true })}
                                    onOpenCreator={(user) => openCreatorCatalog(user, { locationTab: 'paste' })}
                                />
                            ))}
                        </div>
                    </div>
                ) : null}

                <div className="space-y-3 border-t border-white/10 pt-4">
                    <div>
                        <h3 className="text-sm font-bold text-text">Bulk import</h3>
                        <p className="mt-1 text-sm text-muted">One URL per line. Lines starting with # or // are ignored.</p>
                    </div>
                    <textarea
                        className={`appearance-none text-[16px] leading-5 ${fieldClass} min-h-36 font-mono text-[16px]`}
                        value={bulkText}
                        onChange={(event) => setBulkText(event.target.value)}
                        placeholder={'https://mediux.pro/sets/123\nhttps://theposterdb.com/set/456\nhttps://theposterdb.com/posters/789'}
                    />
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={primaryButtonClass} disabled={busy !== null || !bulkText.trim()} onClick={() => void runBulk(false)}>
                            {busy === 'bulk' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            Apply bulk list
                        </button>
                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void runBulk(true)}>
                            {busy === 'bulk-file' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Apply from {configDraft.bulk_txt || 'bulk_import.txt'}
                        </button>
                    </div>
                    {showBulkStatus ? (
                        <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-bold text-text">Bulk progress</p>
                                <StatusPill value={bulkState || 'queued'} />
                            </div>
                            <p className={`text-xs ${bulkState === 'failed' ? 'text-red-300' : bulkState === 'warning' ? 'text-amber-200' : 'text-muted'}`}>
                                {bulkSummary}
                            </p>
                            {bulkJob?.error && bulkState !== 'failed' && bulkState !== 'warning' ? (
                                <p className={`text-xs ${jobErrorTextClass(bulkState)}`}>{bulkJob.error}</p>
                            ) : null}
                            <div
                                ref={bulkLogRef}
                                className="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-[11px] leading-5 text-muted custom-scrollbar"
                            >
                                {bulkLogs.length ? bulkLogs.map((line, index) => (
                                    <p key={`${index}-${line.slice(0, 32)}`}>{line}</p>
                                )) : (
                                    <p>
                                        {bulkState === 'queued' || bulkBusy
                                            ? 'Waiting for the worker to start…'
                                            : 'Waiting for progress…'}
                                    </p>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </section>
        </div>
    );
};
