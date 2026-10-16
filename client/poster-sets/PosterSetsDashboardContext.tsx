import { createContext, useContext } from 'react';
import type { PosterSetsDashboardContextValue } from './posterSetsDashboardContextTypes';

export type { PosterSetsDashboardContextValue } from './posterSetsDashboardContextTypes';

export const PosterSetsDashboardContext = createContext<PosterSetsDashboardContextValue | null>(null);

export function usePosterSetsDashboard(): PosterSetsDashboardContextValue {
    const value = useContext(PosterSetsDashboardContext);
    if (!value) {
        throw new Error('usePosterSetsDashboard must be used within PosterSetsDashboardContext.Provider');
    }
    return value;
}
