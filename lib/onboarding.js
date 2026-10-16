export const MAX_ONBOARDING_STEPS = 20;
export const MAX_ONBOARDING_TITLE = 120;
export const MAX_ONBOARDING_BODY = 8000;
export const MAX_ONBOARDING_LINKS = 12;

export const ONBOARDING_STEP_TYPES = new Set([
    'welcome',
    'rules',
    'text',
    'media_tips',
    'features',
    'links',
    'finish',
]);

const makeId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `onboarding-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const asTrimmed = (value, max) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return text.slice(0, max);
};

const normalizeLinks = (raw) => {
    if (!Array.isArray(raw)) return [];
    const links = [];
    const seen = new Set();
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const label = asTrimmed(entry.label, 80);
        let href = asTrimmed(entry.href, 500);
        if (!label || !href) continue;
        if (/^(javascript|data|vbscript):/i.test(href)) continue;
        if (!(href.startsWith('/') || /^https?:\/\//i.test(href) || href.startsWith('mailto:'))) continue;
        const key = `${label}::${href}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ label, href });
        if (links.length >= MAX_ONBOARDING_LINKS) break;
    }
    return links;
};

export const createDefaultOnboardingSteps = () => ([
    {
        id: 'welcome',
        type: 'welcome',
        title: 'Welcome',
        body: 'Welcome to our media server!\n\nThis short guide will help you get set up and learn how to use StreamPilot.',
        required: true,
        enabled: true,
        requireAck: false,
        links: [],
        order: 0,
    },
    {
        id: 'rules',
        type: 'rules',
        title: 'Server rules',
        body: 'Please be respectful of other members.\n\nDo not share your account.\n\nUse requests for missing content instead of asking the admin privately when possible.',
        required: true,
        enabled: true,
        requireAck: true,
        links: [],
        order: 1,
    },
    {
        id: 'media-tips',
        type: 'media_tips',
        title: 'Install your media app',
        body: 'Download the official app for your device, sign in with the same account you used to join, and look for this shared server in your library list.\n\nTip: start with remote quality set automatically, then raise it if your connection allows.',
        required: false,
        enabled: true,
        requireAck: false,
        links: [],
        order: 2,
    },
    {
        id: 'features',
        type: 'features',
        title: 'Using the portal',
        body: 'StreamPilot is your home for discovering content, making requests, checking your access, and getting help.',
        required: false,
        enabled: true,
        requireAck: false,
        links: [],
        order: 3,
    },
    {
        id: 'links',
        type: 'links',
        title: 'Helpful links',
        body: 'Save these community links for later.',
        required: false,
        enabled: false,
        requireAck: false,
        links: [],
        order: 4,
    },
    {
        id: 'finish',
        type: 'finish',
        title: 'You are all set',
        body: 'Thanks for joining. Head into the portal whenever you are ready.',
        required: true,
        enabled: true,
        requireAck: false,
        links: [],
        order: 5,
    },
]);

export const emptyOnboardingDocument = () => ({
    enabled: false,
    version: 1,
    steps: createDefaultOnboardingSteps(),
});

export const normalizeOnboardingStep = (raw, index = 0) => {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || 'text').trim();
    if (!ONBOARDING_STEP_TYPES.has(type)) return null;
    const title = asTrimmed(raw.title, MAX_ONBOARDING_TITLE);
    if (!title) return null;
    return {
        id: asTrimmed(raw.id, 80) || makeId(),
        type,
        title,
        body: asTrimmed(raw.body, MAX_ONBOARDING_BODY),
        required: raw.required !== false,
        enabled: raw.enabled !== false,
        requireAck: type === 'rules' ? raw.requireAck !== false : !!raw.requireAck,
        links: normalizeLinks(raw.links),
        order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index,
    };
};

export const normalizeOnboardingDocument = (raw, existing = emptyOnboardingDocument()) => {
    const sourceSteps = Array.isArray(raw?.steps)
        ? raw.steps
        : (Array.isArray(existing?.steps) ? existing.steps : createDefaultOnboardingSteps());
    const seen = new Set();
    const steps = [];
    sourceSteps.forEach((entry, index) => {
        const step = normalizeOnboardingStep(entry, index);
        if (!step || seen.has(step.id)) return;
        seen.add(step.id);
        steps.push(step);
    });
    steps.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    steps.forEach((step, index) => { step.order = index; });

    const versionRaw = parseInt(raw?.version ?? existing?.version, 10);
    return {
        enabled: !!(raw?.enabled ?? existing?.enabled),
        version: Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1,
        steps: steps.length > 0 ? steps.slice(0, MAX_ONBOARDING_STEPS) : createDefaultOnboardingSteps(),
    };
};

export const getEnabledOnboardingSteps = (doc) => (
    normalizeOnboardingDocument(doc).steps.filter((step) => step.enabled !== false)
);

export const isOnboardingPending = (user, doc, { isAdmin = false } = {}) => {
    if (isAdmin) return false;
    const normalized = normalizeOnboardingDocument(doc);
    if (!normalized.enabled) return false;
    if (!user || typeof user !== 'object') return false;
    if (getEnabledOnboardingSteps(normalized).length === 0) return false;
    return user.onboardingCompleted === false;
};

export const markUserOnboardingPending = (user, doc) => {
    if (!user || typeof user !== 'object') return user;
    const normalized = normalizeOnboardingDocument(doc);
    if (!normalized.enabled) return user;
    return {
        ...user,
        onboardingCompleted: false,
        onboardingCompletedAt: null,
        onboardingVersion: normalized.version,
        onboardingAckedStepIds: [],
    };
};

export const markUserOnboardingComplete = (user, doc, ackedStepIds = []) => {
    if (!user || typeof user !== 'object') return user;
    const normalized = normalizeOnboardingDocument(doc);
    return {
        ...user,
        onboardingCompleted: true,
        onboardingCompletedAt: new Date().toISOString(),
        onboardingVersion: normalized.version,
        onboardingAckedStepIds: Array.isArray(ackedStepIds)
            ? ackedStepIds.map((id) => String(id).trim()).filter(Boolean).slice(0, MAX_ONBOARDING_STEPS)
            : [],
    };
};

export const validateOnboardingCompletion = (doc, ackedStepIds = []) => {
    const enabledSteps = getEnabledOnboardingSteps(doc);
    const acked = new Set((Array.isArray(ackedStepIds) ? ackedStepIds : []).map((id) => String(id).trim()));
    const missing = enabledSteps
        .filter((step) => step.requireAck && !acked.has(step.id))
        .map((step) => step.id);
    return { ok: missing.length === 0, missing };
};
