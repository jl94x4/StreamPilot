import fs from 'fs';

const normalizeChangelog = (changelog) => changelog.replace(/\r\n/g, '\n');

const stripChangelogItem = (line) => (
    line
        .replace(/^\* /, '')
        .replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)\s*$/i, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim()
);

const parseLatestRelease = (changelog) => {
    const normalized = normalizeChangelog(changelog);
    const headerMatch = normalized.match(/^## \[([\d.]+)\][^\n]*\(([^)]+)\)/m);
    if (!headerMatch) return null;

    const version = headerMatch[1];
    const date = headerMatch[2].trim();
    const bodyStart = headerMatch.index + headerMatch[0].length;
    const nextVersionIdx = normalized.indexOf('\n## [', bodyStart);
    const body = normalized.slice(bodyStart, nextVersionIdx === -1 ? undefined : nextVersionIdx);
    const sections = [];

    for (const part of body.split(/\n### /).map((chunk) => chunk.trim()).filter(Boolean)) {
        const lines = part.split('\n');
        const title = lines[0]?.trim();
        if (!title) continue;

        const items = lines
            .map((line) => line.trim())
            .filter((line) => line.startsWith('* '))
            .map((line) => stripChangelogItem(line))
            .filter(Boolean);

        if (items.length > 0) {
            sections.push({ title, items });
        }
    }

    return {
        version,
        date,
        title: `What's new in v${version}`,
        sections,
        changelogUrl: 'https://github.com/jl94x4/StreamPilot/blob/main/CHANGELOG.md',
    };
};

try {
    const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
    const release = parseLatestRelease(changelog) || {
        version: null,
        date: null,
        title: "What's new",
        sections: [],
        changelogUrl: 'https://github.com/jl94x4/StreamPilot/blob/main/CHANGELOG.md',
    };
    fs.mkdirSync('static', { recursive: true });
    fs.writeFileSync('static/release-notes.json', `${JSON.stringify(release, null, 2)}\n`);
    console.log(`Wrote release notes for v${release.version || 'unknown'} (${release.sections.length} sections)`);
} catch (e) {
    console.warn('Could not build release notes:', e.message);
    fs.mkdirSync('static', { recursive: true });
    fs.writeFileSync('static/release-notes.json', `${JSON.stringify({
        version: null,
        date: null,
        title: "What's new",
        sections: [],
        changelogUrl: 'https://github.com/jl94x4/StreamPilot/blob/main/CHANGELOG.md',
    }, null, 2)}\n`);
}
