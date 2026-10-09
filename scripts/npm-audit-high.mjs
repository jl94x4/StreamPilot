import { execSync } from 'node:child_process';

/** Advisories with no compatible patched release. npm's only "fix" for braces is Tailwind 4. */
const ALLOWED = new Set([
    'GHSA-vfj7-8cjw-p6xm',
]);

let stdout;
try {
    stdout = execSync('npm audit --json', {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
} catch (err) {
    stdout = err.stdout;
}

let report;
try {
    report = JSON.parse(stdout || '{}');
} catch {
    console.error(stdout);
    process.exit(1);
}

const blocking = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities || {})) {
    if (!['high', 'critical'].includes(vuln.severity)) continue;
    const advisories = (vuln.via || []).filter((entry) => entry && typeof entry === 'object');
    if (advisories.length === 0) continue;
    const remaining = advisories.filter((entry) => {
        const id = String(entry.url || '').split('/').pop();
        return !ALLOWED.has(id);
    });
    if (remaining.length) {
        blocking.push(`${vuln.severity} ${name}: ${remaining.map((entry) => entry.url || entry.title).join(', ')}`);
    }
}

if (blocking.length) {
    console.error(blocking.join('\n'));
    process.exit(1);
}

console.log('npm audit high+ clean (unfixed braces GHSA-vfj7-8cjw-p6xm allowlisted)');
