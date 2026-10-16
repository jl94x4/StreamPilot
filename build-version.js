import fs from 'fs';
import { execSync } from 'child_process';
import { resolvePackageVersion } from './lib/resolve-package-version.js';

const normalizeSha = (sha, pkgVersion) => {
    if (!sha) return '';
    const trimmed = String(sha).trim();
    const prefixRegex = new RegExp(`^v${String(pkgVersion).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`, 'i');
    const withoutPrefix = trimmed.replace(prefixRegex, '');
    return withoutPrefix.slice(0, 7);
};

const resolveBuildVersion = (pkgVersion) => {
    const fromEnv = normalizeSha(process.env.GIT_SHA || process.env.GITHUB_SHA || '', pkgVersion);
    if (fromEnv) return fromEnv;

    try {
        const sha = execSync('git rev-parse --short HEAD', { stdio: 'pipe' }).toString().trim();
        try {
            execSync('git diff --quiet && git diff --cached --quiet', { stdio: 'pipe', shell: true });
            return sha;
        } catch {
            return `${sha}-${Date.now().toString(36)}`;
        }
    } catch {
        return `build-${Date.now()}`;
    }
};

const pkgVersion = resolvePackageVersion();
const assetVersion = resolveBuildVersion(pkgVersion);

const isTag = process.env.GITHUB_REF && process.env.GITHUB_REF.startsWith('refs/tags/');
const finalVersion = isTag ? `v${pkgVersion}` : `v${pkgVersion}-${assetVersion}`;

fs.writeFileSync('version.txt', finalVersion);
console.log(`Stamped version: ${finalVersion}`);

try {
    const indexPath = 'index.html';
    const html = fs.readFileSync(indexPath, 'utf8');
    const stamped = html
        .replace(/(?:\/)?static\/tailwind\.css\?v=[^"']+/g, `static/tailwind.css?v=${assetVersion}`)
        .replace(/(?:\/)?static\/index\.js\?v=[^"']+/g, `static/index.js?v=${assetVersion}`);
    fs.writeFileSync(indexPath, stamped);
} catch (e) {
    console.warn('Could not stamp index.html asset versions:', e.message);
}
