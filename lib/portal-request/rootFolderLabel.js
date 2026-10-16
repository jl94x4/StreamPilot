/** Last path segment of an *arr root folder (`/media/films` → `films`). */
export const rootFolderDisplayName = (path) => {
    const cleaned = String(path || '').replace(/[\\/]+$/, '');
    const parts = cleaned.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || cleaned || String(path || '');
};

/**
 * Label for request UI: folder name, or full path when two folders share a name.
 * Optional `freeText` is appended, e.g. `films (30.2 TB free)`.
 */
export const formatRootFolderLabel = (folder = {}, { folders = [], freeText = '' } = {}) => {
    const path = String(folder?.path || '');
    const name = rootFolderDisplayName(path);
    const list = Array.isArray(folders) && folders.length ? folders : [folder];
    const collisions = list.filter((row) => rootFolderDisplayName(row?.path) === name).length > 1;
    const label = collisions ? path : name;
    const free = String(freeText || '').trim();
    return free ? `${label} (${free})` : label;
};
