import React from 'react';
import {
    normalizeSectionLayout,
    resolveDashboardSections,
    resolveMainGridWidgets,
    resolveRecentlyAddedWidgets,
    splitMainGridForDesktop,
    type DashboardLayoutContext,
    type MainGridWidgetId,
    type RecentlyAddedWidgetId,
} from '../shared/dashboardLayout';
import { parseHomeCustomModuleSectionId } from '../shared/homeCustomModules';
import type { HomeCustomModule } from '../shared/types';

const findWatchRowIndexAfterMainGrid = (sections: ReturnType<typeof resolveDashboardSections>, mainGridIndex: number) => {
    for (let j = mainGridIndex + 1; j < sections.length; j += 1) {
        const id = sections[j];
        if (id === 'watchRow') return j;
        if (id !== 'pendingRequests') return -1;
    }
    return -1;
};

const findRecentlyAddedIndexAfterMainGrid = (sections: ReturnType<typeof resolveDashboardSections>, mainGridIndex: number) => {
    for (let j = mainGridIndex + 1; j < sections.length; j += 1) {
        const id = sections[j];
        if (id === 'recentlyAdded') return j;
        if (id !== 'pendingRequests' && id !== 'watchRow') return -1;
    }
    return -1;
};

/** Break out of the 2/3 dashboard column so recently-added rows span the full grid width. */
const RECENTLY_ADDED_FULL_BLEED_CLASS = 'w-full lg:relative lg:left-[calc(-50%-0.5rem)] lg:w-[calc(150%+1rem)]';

type Props = {
    layoutConfig: unknown;
    layoutCtx: DashboardLayoutContext;
    renderWrapUp: () => React.ReactNode;
    renderMainGridWidget: (id: MainGridWidgetId) => React.ReactNode;
    renderPendingRequests: () => React.ReactNode;
    renderScanner?: () => React.ReactNode;
    renderSpotifySync?: () => React.ReactNode;
    renderMediaAutomation?: () => React.ReactNode;
    renderBazarrTools?: () => React.ReactNode;
    renderWatchRowLeft?: () => React.ReactNode;
    renderWatchRowRight?: () => React.ReactNode;
    renderBecauseYouWatched?: () => React.ReactNode;
    renderRecentlyAddedWidget: (id: RecentlyAddedWidgetId) => React.ReactNode;
    renderRecentlyAddedSkeleton: () => React.ReactNode;
    recentlyAddedLoading: boolean;
    hasDashboardData: boolean;
    homeCustomModules?: HomeCustomModule[];
    renderCustomModule?: (module: HomeCustomModule) => React.ReactNode;
};

export const UserDashboardLayout: React.FC<Props> = ({
    layoutConfig,
    layoutCtx,
    renderWrapUp,
    renderMainGridWidget,
    renderPendingRequests,
    renderScanner,
    renderSpotifySync,
    renderMediaAutomation,
    renderBazarrTools,
    renderWatchRowLeft,
    renderWatchRowRight,
    renderBecauseYouWatched,
    renderRecentlyAddedWidget,
    renderRecentlyAddedSkeleton,
    recentlyAddedLoading,
    hasDashboardData,
    homeCustomModules = [],
    renderCustomModule,
}) => {
    const layout = normalizeSectionLayout(layoutConfig, { homeCustomModules });
    const layoutCtxWithModules = { ...layoutCtx, homeCustomModules };
    const sections = resolveDashboardSections(layout, layoutCtxWithModules);
    const mainGridWidgets = resolveMainGridWidgets(layout, layoutCtxWithModules);
    const { left, right } = splitMainGridForDesktop(mainGridWidgets);
    const recentlyAdded = resolveRecentlyAddedWidgets(layout);

    const renderMainGridColumns = () => (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 items-start">
            <div className="lg:col-span-1 flex flex-col gap-3 md:gap-4 min-h-0">
                {left.map((id) => (
                    <React.Fragment key={id}>{renderMainGridWidget(id)}</React.Fragment>
                ))}
            </div>
            <div className="lg:col-span-2 flex flex-col gap-3 md:gap-4 min-h-0">
                {right.map((id) => (
                    <React.Fragment key={id}>{renderMainGridWidget(id)}</React.Fragment>
                ))}
            </div>
        </div>
    );

    const renderWatchRowColumns = () => {
        const recentlyWatched = renderWatchRowLeft?.();
        const mostWatched = renderWatchRowRight?.();
        if (!recentlyWatched && !mostWatched) return null;
        return (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 items-start">
                {recentlyWatched ? (
                    <div className="lg:col-span-1 flex flex-col gap-3 md:gap-4 min-h-0">
                        {recentlyWatched}
                    </div>
                ) : null}
                {mostWatched ? (
                    <div className={`flex flex-col gap-3 md:gap-4 min-h-0 ${recentlyWatched ? 'lg:col-span-2' : 'lg:col-span-2 lg:col-start-2'}`}>
                        {mostWatched}
                    </div>
                ) : null}
            </div>
        );
    };

    const renderRecentlyAddedRows = () => (
        <>
            {recentlyAdded.map((id) => (
                <React.Fragment key={id}>{renderRecentlyAddedWidget(id)}</React.Fragment>
            ))}
        </>
    );

    const renderBecauseYouWatchedRow = () => renderBecauseYouWatched?.() || null;

    const renderMergedMainAndWatchGrid = (opts?: { includeRecentlyAdded?: boolean }) => {
        const recentlyWatched = renderWatchRowLeft?.();
        const mostWatched = renderWatchRowRight?.();
        const showRecentlyAdded = !!opts?.includeRecentlyAdded && hasDashboardData && recentlyAdded.length > 0;
        const becauseYouWatched = renderBecauseYouWatchedRow();
        return (
            <>
                <div className="hidden lg:grid lg:grid-cols-3 gap-3 md:gap-4 items-start w-full">
                    <div className="flex flex-col gap-3 md:gap-4 min-h-0">
                        {left.map((id) => (
                            <React.Fragment key={id}>{renderMainGridWidget(id)}</React.Fragment>
                        ))}
                        {recentlyWatched}
                    </div>
                    <div className="lg:col-span-2 flex flex-col gap-3 md:gap-4 min-h-0">
                        {right.map((id) => (
                            <React.Fragment key={id}>{renderMainGridWidget(id)}</React.Fragment>
                        ))}
                        {mostWatched}
                    </div>
                </div>
                <div className="lg:hidden flex flex-col gap-3 md:gap-4 w-full">
                    {renderMainGridColumns()}
                    {renderWatchRowColumns()}
                </div>
                {becauseYouWatched}
                {showRecentlyAdded ? (
                    <>
                        <div className="hidden lg:flex flex-col gap-3 md:gap-4 w-full">
                            {renderRecentlyAddedRows()}
                        </div>
                        <div className="lg:hidden flex flex-col gap-3 md:gap-4 w-full">
                            {renderRecentlyAddedRows()}
                        </div>
                    </>
                ) : null}
            </>
        );
    };

    const sectionNodes: React.ReactNode[] = [];
    const mergedWatchRowIndices = new Set<number>();
    const mergedRecentlyAddedIndices = new Set<number>();
    let becauseYouWatchedPlaced = false;
    const pushBecauseYouWatched = () => {
        if (becauseYouWatchedPlaced) return;
        const content = renderBecauseYouWatchedRow();
        if (!content) return;
        becauseYouWatchedPlaced = true;
        sectionNodes.push(
            <div key="becauseYouWatched" className="relative w-full min-w-0">
                {content}
            </div>
        );
    };

    for (let index = 0; index < sections.length; index += 1) {
        const sectionId = sections[index];
        switch (sectionId) {
            case 'wrapUp': {
                const content = renderWrapUp();
                if (!content) break;
                sectionNodes.push(
                    <div key="wrapUp" className="relative w-full min-w-0">
                        {content}
                    </div>
                );
                break;
            }
            case 'mainGrid': {
                if (mainGridWidgets.length === 0) break;
                const watchRowIndex = findWatchRowIndexAfterMainGrid(sections, index);
                const recentlyAddedIndex = findRecentlyAddedIndexAfterMainGrid(sections, index);
                const canMergeWatchRow = watchRowIndex >= 0 && (renderWatchRowLeft || renderWatchRowRight);
                const canMergeRecentlyAdded = recentlyAddedIndex >= 0;
                if (canMergeWatchRow || canMergeRecentlyAdded) {
                    if (watchRowIndex >= 0) mergedWatchRowIndices.add(watchRowIndex);
                    if (recentlyAddedIndex >= 0) mergedRecentlyAddedIndices.add(recentlyAddedIndex);
                    becauseYouWatchedPlaced = true;
                    sectionNodes.push(
                        <div key="mainGrid-dashboard" className="relative w-full min-w-0 flex flex-col gap-3 md:gap-4">
                            {renderMergedMainAndWatchGrid({ includeRecentlyAdded: canMergeRecentlyAdded && !(recentlyAddedLoading && !hasDashboardData) })}
                            {recentlyAddedLoading && !hasDashboardData ? renderRecentlyAddedSkeleton() : null}
                        </div>
                    );
                    break;
                }
                sectionNodes.push(
                    <div key="mainGrid" className="relative w-full min-w-0">
                        {renderMainGridColumns()}
                    </div>
                );
                if (watchRowIndex < 0) pushBecauseYouWatched();
                break;
            }
            case 'pendingRequests': {
                const content = renderPendingRequests();
                if (!content) break;
                sectionNodes.push(
                    <div key="pendingRequests" className="relative z-[2] w-full min-w-0 isolate">
                        {content}
                    </div>
                );
                break;
            }
            case 'watchRow': {
                if (mergedWatchRowIndices.has(index)) break;
                const content = renderWatchRowColumns();
                if (!content) {
                    pushBecauseYouWatched();
                    break;
                }
                sectionNodes.push(
                    <div key="watchRow" className="relative z-[1] w-full min-w-0">
                        {content}
                    </div>
                );
                pushBecauseYouWatched();
                break;
            }
            case 'scanner': {
                const content = renderScanner?.();
                if (!content) break;
                sectionNodes.push(
                    <div key="scanner" className="relative z-[1] w-full min-w-0">
                        {content}
                    </div>
                );
                break;
            }
            case 'spotifySync': {
                const content = renderSpotifySync?.();
                if (!content) break;
                sectionNodes.push(
                    <div key="spotifySync" className="relative z-[1] w-full min-w-0">
                        {content}
                    </div>
                );
                break;
            }
            case 'mediaAutomation': {
                const content = renderMediaAutomation?.();
                if (!content) break;
                sectionNodes.push(
                    <div key="mediaAutomation" className="relative z-[1] w-full min-w-0">
                        {content}
                    </div>
                );
                break;
            }
            case 'recentlyAdded':
                if (mergedRecentlyAddedIndices.has(index)) break;
                if (recentlyAddedLoading && !hasDashboardData) {
                    sectionNodes.push(
                        <div key="recentlyAdded" className="relative w-full min-w-0">
                            {renderRecentlyAddedSkeleton()}
                        </div>
                    );
                    break;
                }
                if (!hasDashboardData) break;
                sectionNodes.push(
                    <div key="recentlyAdded" className="relative w-full min-w-0 flex flex-col gap-3 md:gap-4">
                        {recentlyAdded.map((id) => (
                            <React.Fragment key={id}>{renderRecentlyAddedWidget(id)}</React.Fragment>
                        ))}
                    </div>
                );
                break;
            case 'bazarrTools': {
                const content = renderBazarrTools?.();
                if (!content) break;
                sectionNodes.push(
                    <div key="bazarrTools" className="relative w-full min-w-0">
                        {content}
                    </div>
                );
                break;
            }
            default: {
                const moduleId = parseHomeCustomModuleSectionId(sectionId);
                if (!moduleId || !renderCustomModule) break;
                const module = homeCustomModules.find((entry) => String(entry.id) === moduleId);
                if (!module) break;
                const content = renderCustomModule(module);
                if (!content) break;
                sectionNodes.push(
                    <div key={sectionId} className="relative w-full min-w-0">
                        {content}
                    </div>
                );
                break;
            }
        }
    }
    pushBecauseYouWatched();

    return (
        <div className="grid grid-cols-1 gap-3 md:gap-4 w-full">
            {sectionNodes}
        </div>
    );
};
