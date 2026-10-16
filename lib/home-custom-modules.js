export const HOME_CUSTOM_MODULE_SECTION_PREFIX = 'customModule:';
export const MAX_HOME_CUSTOM_MODULES = 20;
const ALLOWED_MODES = new Set(['html', 'iframe']);

export const homeCustomModuleSectionId = (id) => `${HOME_CUSTOM_MODULE_SECTION_PREFIX}${String(id || '').trim()}`;

export const parseHomeCustomModuleSectionId = (sectionId) => {
    const raw = String(sectionId || '');
    if (!raw.startsWith(HOME_CUSTOM_MODULE_SECTION_PREFIX)) return null;
    const id = raw.slice(HOME_CUSTOM_MODULE_SECTION_PREFIX.length).trim();
    return id || null;
};

export const isHomeCustomModuleSectionId = (sectionId) => !!parseHomeCustomModuleSectionId(sectionId);

const isSafeIframeUrl = (url) => {
    const value = String(url || '').trim();
    if (!value) return false;
    if (/^(javascript|data|vbscript):/i.test(value)) return false;
    if (value.startsWith('/')) return true;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const normalizeMode = (value) => {
    const mode = String(value || '').trim();
    return ALLOWED_MODES.has(mode) ? mode : 'html';
};

const makeId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `module-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

export const normalizeHomeCustomModules = (modules, existing = []) => {
    const source = Array.isArray(modules) ? modules : (Array.isArray(existing) ? existing : []);
    const seen = new Set();
    const result = [];
    for (const raw of source) {
        if (!raw || typeof raw !== 'object') continue;
        const id = String(raw.id || '').trim() || makeId();
        if (seen.has(id)) continue;
        const title = String(raw.title || '').trim();
        if (!title) continue;
        const mode = normalizeMode(raw.mode);
        const url = String(raw.url || '').trim();
        const html = String(raw.html || '');
        const css = String(raw.css || '');
        if (mode === 'iframe' && !isSafeIframeUrl(url)) continue;
        if (mode === 'html' && !html.trim() && !css.trim()) continue;
        seen.add(id);
        const description = String(raw.description || '').trim().slice(0, 240);
        result.push({
            id,
            title: title.slice(0, 80),
            description: description || undefined,
            enabled: raw.enabled !== false,
            adminOnly: !!raw.adminOnly,
            mode,
            html: mode === 'html' ? html : undefined,
            css: mode === 'html' ? css : undefined,
            url: mode === 'iframe' ? url : undefined,
        });
        if (result.length >= MAX_HOME_CUSTOM_MODULES) break;
    }
    return result;
};

export const sanitizeHomeCustomModulesForSession = (modules = [], isAdmin = false) => (
    normalizeHomeCustomModules(modules)
        .filter((module) => module.enabled && (!module.adminOnly || isAdmin))
        .map((module) => ({ ...module }))
);

const insertMissingBuiltInSection = (result, allowed, id, defaultIndex) => {
    if (result.includes(id)) return;
    let insertAt = result.length;
    for (let i = defaultIndex - 1; i >= 0; i -= 1) {
        const prevIdx = result.indexOf(allowed[i]);
        if (prevIdx >= 0) {
            insertAt = prevIdx + 1;
            break;
        }
    }
    if (insertAt === result.length) {
        for (let i = defaultIndex + 1; i < allowed.length; i += 1) {
            const nextIdx = result.indexOf(allowed[i]);
            if (nextIdx >= 0) {
                insertAt = nextIdx;
                break;
            }
        }
    }
    result.splice(insertAt, 0, id);
};

export const normalizeDashboardSectionIds = (
    values,
    allowedBuiltIn,
    fallbackBuiltIn,
    moduleIds = new Set(),
    { fillMissingBuiltIn = true } = {},
) => {
    const incoming = Array.isArray(values) ? values : [];
    const seen = new Set();
    const result = [];
    for (const raw of incoming) {
        const id = String(raw || '').trim();
        if (!id || seen.has(id)) continue;
        if (allowedBuiltIn.includes(id)) {
            seen.add(id);
            result.push(id);
            continue;
        }
        if (isHomeCustomModuleSectionId(id)) {
            const moduleId = parseHomeCustomModuleSectionId(id);
            if (moduleId && moduleIds.has(moduleId)) {
                seen.add(id);
                result.push(id);
            }
        }
    }
    if (fillMissingBuiltIn) {
        allowedBuiltIn.forEach((id, defaultIndex) => {
            if (seen.has(id)) return;
            insertMissingBuiltInSection(result, allowedBuiltIn, id, defaultIndex);
            seen.add(id);
        });
    } else if (!result.length) {
        return [...fallbackBuiltIn];
    }
    return result;
};

export const pruneDashboardLayoutCustomModules = (layout = {}, modules = []) => {
    const moduleIds = new Set(
        normalizeHomeCustomModules(modules)
            .filter((module) => module.enabled)
            .map((module) => module.id),
    );
    const sections = Array.isArray(layout.sections) ? layout.sections : [];
    const hiddenSections = Array.isArray(layout.hiddenSections) ? layout.hiddenSections : [];
    return {
        ...layout,
        sections: sections.filter((id) => !isHomeCustomModuleSectionId(id) || moduleIds.has(parseHomeCustomModuleSectionId(id))),
        hiddenSections: hiddenSections.filter((id) => !isHomeCustomModuleSectionId(id) || moduleIds.has(parseHomeCustomModuleSectionId(id))),
    };
};

export const insertHomeModuleSection = (sections, moduleId, anchor = 'recentlyAdded') => {
    const sectionId = homeCustomModuleSectionId(moduleId);
    if (sections.includes(sectionId)) return sections;
    const anchorIndex = sections.indexOf(anchor);
    if (anchorIndex >= 0) {
        const next = [...sections];
        next.splice(anchorIndex, 0, sectionId);
        return next;
    }
    return [...sections, sectionId];
};

export const removeHomeModuleSection = (sections, moduleId) => (
    sections.filter((id) => id !== homeCustomModuleSectionId(moduleId))
);
