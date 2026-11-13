import { useSyncExternalStore } from 'react';
import { readPersistedView, writePersistedView } from './usePersistedState';

/* ------------------------------ Layout (grid / list / compact) ------------------------------ */

export type DiscoverLayout = 'grid' | 'list' | 'compact';
export const DISCOVER_LAYOUTS: DiscoverLayout[] = ['grid', 'list', 'compact'];

const LAYOUT_KEY = 'browse.layout';
const layoutListeners = new Set<() => void>();
let layoutValue: DiscoverLayout | null = null;

const currentLayout = (): DiscoverLayout => {
    if (layoutValue) return layoutValue;
    layoutValue = readPersistedView<DiscoverLayout>(
        LAYOUT_KEY,
        'grid',
        (v) => DISCOVER_LAYOUTS.includes(v as DiscoverLayout),
    );
    return layoutValue;
};

export const setDiscoverLayout = (next: DiscoverLayout) => {
    if (next === currentLayout()) return;
    layoutValue = next;
    writePersistedView(LAYOUT_KEY, next);
    layoutListeners.forEach((fn) => fn());
};

const subscribeLayout = (fn: () => void) => {
    layoutListeners.add(fn);
    return () => { layoutListeners.delete(fn); };
};

/** Layout is shared by every Discover browse page so the choice sticks as you move around. */
export const useDiscoverLayout = () => (
    [useSyncExternalStore(subscribeLayout, currentLayout, () => 'grid' as DiscoverLayout), setDiscoverLayout] as const
);

/* ------------------------------ Multi-select ------------------------------ */

type SelectionState = {
    active: boolean;
    items: ReadonlyMap<string, any>;
};

let selection: SelectionState = { active: false, items: new Map() };
const selectionListeners = new Set<() => void>();
const commitSelection = (next: SelectionState) => {
    selection = next;
    selectionListeners.forEach((fn) => fn());
};

export const discoverSelection = {
    setActive(active: boolean) {
        commitSelection({ active, items: active ? selection.items : new Map() });
    },
    enter(key: string, item: any) {
        const items = new Map(selection.items);
        items.set(key, item);
        commitSelection({ active: true, items });
    },
    toggle(key: string, item: any) {
        const items = new Map(selection.items);
        if (items.has(key)) items.delete(key);
        else items.set(key, item);
        commitSelection({ active: selection.active, items });
    },
    clear() {
        commitSelection({ active: selection.active, items: new Map() });
    },
    remove(keys: string[]) {
        const items = new Map(selection.items);
        keys.forEach((key) => items.delete(key));
        commitSelection({ active: selection.active, items });
    },
};

const subscribeSelection = (fn: () => void) => {
    selectionListeners.add(fn);
    return () => { selectionListeners.delete(fn); };
};

export const useDiscoverSelection = () => useSyncExternalStore(
    subscribeSelection,
    () => selection,
    () => selection,
);

/** Per-cell read so only the cell whose state changed re-renders. */
export const useDiscoverCellSelected = (key: string) => useSyncExternalStore(
    subscribeSelection,
    () => selection.items.has(key),
    () => false,
);

export const useDiscoverSelectMode = () => useSyncExternalStore(
    subscribeSelection,
    () => selection.active,
    () => false,
);
