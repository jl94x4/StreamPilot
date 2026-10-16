const providers = [];

export const registerPortalJobProvider = (provider) => {
    if (typeof provider !== 'function') return;
    providers.push(provider);
};

export const listRegisteredPortalJobs = () => {
    const jobs = [];
    for (const provider of providers) {
        try {
            const rows = provider();
            if (!Array.isArray(rows)) continue;
            for (const row of rows) {
                if (row && row.status === 'running') jobs.push(row);
            }
        } catch {
            // A broken provider must not hide the others.
        }
    }
    return jobs;
};

export const resetPortalJobProvidersForTests = () => {
    providers.length = 0;
};
