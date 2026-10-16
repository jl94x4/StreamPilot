import React from 'react';
import { PosterSetsDashboardContext } from './PosterSetsDashboardContext';
import { usePosterSetsDashboardState } from './usePosterSetsDashboard';
import { PosterSetsShell } from './views/PosterSetsShell';

export const PosterSetsDashboard: React.FC = () => {
    const value = usePosterSetsDashboardState();
    return (
        <PosterSetsDashboardContext.Provider value={value}>
            <PosterSetsShell />
        </PosterSetsDashboardContext.Provider>
    );
};

export default PosterSetsDashboard;
