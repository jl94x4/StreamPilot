import type { HomeCustomModule } from './types';
import { portalUrl } from './basePath';
import { detectCustomTabEmbedIssue, shouldUseCustomTabEmbedProxy } from './customNavTabs';

export const HOME_CUSTOM_MODULE_SECTION_PREFIX = 'customModule:';

export const homeCustomModuleSectionId = (id: string) => `${HOME_CUSTOM_MODULE_SECTION_PREFIX}${String(id || '').trim()}`;

export const parseHomeCustomModuleSectionId = (sectionId: string): string | null => {
    const raw = String(sectionId || '');
    if (!raw.startsWith(HOME_CUSTOM_MODULE_SECTION_PREFIX)) return null;
    const id = raw.slice(HOME_CUSTOM_MODULE_SECTION_PREFIX.length).trim();
    return id || null;
};

export const isHomeCustomModuleSectionId = (sectionId: string) => !!parseHomeCustomModuleSectionId(sectionId);

export const buildHomeCustomModuleMap = (modules: HomeCustomModule[] = []) => (
    new Map(modules.map((module) => [String(module.id), module]))
);

export const getHomeCustomModuleLabel = (sectionId: string, modules: HomeCustomModule[] = []) => {
    const id = parseHomeCustomModuleSectionId(sectionId);
    if (!id) return sectionId;
    const module = modules.find((entry) => String(entry.id) === id);
    return module?.title || sectionId;
};

export const canAccessHomeCustomModule = (module: HomeCustomModule | undefined, isAdmin: boolean) => (
    !!module && module.enabled && (!module.adminOnly || isAdmin)
);

export const getHomeModuleEmbedProxySrc = (moduleId: string) => (
    portalUrl(`/api/home-module-embed/${encodeURIComponent(moduleId)}/`)
);

export const resolveHomeModuleIframeSrc = (module: HomeCustomModule) => {
    if (!module.url) return '';
    if (shouldUseCustomTabEmbedProxy(module.url)) {
        return getHomeModuleEmbedProxySrc(module.id);
    }
    return module.url;
};

export const createDefaultHomeCustomModule = (): HomeCustomModule => ({
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `module-${Date.now()}`,
    title: 'New module',
    enabled: true,
    adminOnly: false,
    mode: 'html',
    html: '<p>Hello from your custom home module.</p>',
    css: '',
});

export const insertHomeModuleSection = (sections: string[], moduleId: string, anchor = 'recentlyAdded') => {
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

export const removeHomeModuleSection = (sections: string[], moduleId: string) => (
    sections.filter((id) => id !== homeCustomModuleSectionId(moduleId))
);

const insertMissingBuiltInSection = (result: string[], allowed: string[], id: string, defaultIndex: number) => {
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
    values: unknown,
    allowedBuiltIn: string[],
    fallbackBuiltIn: string[],
    moduleIds = new Set<string>(),
    { fillMissingBuiltIn = true }: { fillMissingBuiltIn?: boolean } = {},
) => {
    const incoming = Array.isArray(values) ? values : [];
    const seen = new Set<string>();
    const result: string[] = [];
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
        allowedBuiltIn.forEach((builtInId, defaultIndex) => {
            if (seen.has(builtInId)) return;
            insertMissingBuiltInSection(result, allowedBuiltIn, builtInId, defaultIndex);
            seen.add(builtInId);
        });
    } else if (!result.length) {
        return [...fallbackBuiltIn];
    }
    return result;
};

export const pruneDashboardLayoutCustomModules = (layout: Partial<{ sections?: string[]; hiddenSections?: string[] }>, modules: HomeCustomModule[] = []) => {
    const moduleIds = new Set(
        modules
            .filter((module) => module.enabled)
            .map((module) => String(module.id)),
    );
    const sections = Array.isArray(layout.sections) ? layout.sections : [];
    const hiddenSections = Array.isArray(layout.hiddenSections) ? layout.hiddenSections : [];
    return {
        ...layout,
        sections: sections.filter((id) => !isHomeCustomModuleSectionId(id) || moduleIds.has(parseHomeCustomModuleSectionId(id) || '')),
        hiddenSections: hiddenSections.filter((id) => !isHomeCustomModuleSectionId(id) || moduleIds.has(parseHomeCustomModuleSectionId(id) || '')),
    };
};

export const homeModuleUsesProxy = (module: HomeCustomModule) => (
    module.mode === 'iframe' && !!module.url && shouldUseCustomTabEmbedProxy(module.url)
);

export const homeModuleEmbedIssue = (module: HomeCustomModule) => {
    if (module.mode !== 'iframe' || !module.url) return null;
    if (homeModuleUsesProxy(module)) return null;
    return detectCustomTabEmbedIssue(module.url);
};
