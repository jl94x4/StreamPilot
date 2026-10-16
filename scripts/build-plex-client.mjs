#!/usr/bin/env node
/**
 * Build the portal-backed Media Player web assets into plex-client/dist
 * for Capacitor (phone + Android TV).
 */
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'plex-client', 'dist');

fs.mkdirSync(outDir, { recursive: true });

const portalUrl = String(process.env.PLEX_CLIENT_PORTAL_URL || '').replace(/\/+$/, '');
// Play Store builds must ship with an empty portalBaseUrl so each user enters their StreamPilot host.
const injectPortal = process.env.PLEX_CLIENT_STORE_BUILD === '1' ? '' : portalUrl;

const readAndroidAppVersion = () => {
    const gradlePath = path.join(root, 'plex-client', 'android', 'app', 'build.gradle');
    const src = fs.readFileSync(gradlePath, 'utf8');
    const versionName = (src.match(/versionName\s+"([^"]+)"/) || [])[1] || '';
    const versionCode = (src.match(/versionCode\s+(\d+)/) || [])[1] || '';
    return { versionName, versionCode };
};

const { versionName: appVersion, versionCode: appVersionCode } = readAndroidAppVersion();

const html = fs.readFileSync(path.join(root, 'plex-client', 'index.html'), 'utf8');
const assetStamp = Date.now().toString(36);
const injected = html
    .replace(
        "portalBaseUrl: ''",
        `portalBaseUrl: ${JSON.stringify(injectPortal)}`,
    )
    .replace(
        "appVersion: ''",
        `appVersion: ${JSON.stringify(appVersion)}`,
    )
    .replace('./tailwind.css"', `./tailwind.css?v=${assetStamp}"`)
    .replace('./plex-client.js"', `./plex-client.js?v=${assetStamp}"`);
fs.writeFileSync(path.join(outDir, 'index.html'), injected);

// Reuse portal Tailwind build when present; otherwise leave a minimal fallback.
const twSrc = path.join(root, 'static', 'tailwind.css');
const twDest = path.join(outDir, 'tailwind.css');
if (fs.existsSync(twSrc)) {
    fs.copyFileSync(twSrc, twDest);
} else {
    const cssBuild = spawnSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['tailwindcss', '-i', './input.css', '-o', twDest],
        { cwd: root, stdio: 'inherit', shell: false },
    );
    if (cssBuild.status !== 0) {
        fs.writeFileSync(twDest, '/* tailwind build skipped */\nbody{font-family:system-ui,sans-serif}\n');
    }
}

const logoSrc = path.join(root, 'static', 'logo.png');
if (fs.existsSync(logoSrc)) {
    fs.copyFileSync(logoSrc, path.join(outDir, 'logo.png'));
}

const fontsSrc = path.join(root, 'plex-client', 'fonts');
const fontsDest = path.join(outDir, 'fonts');
if (fs.existsSync(fontsSrc)) {
    fs.mkdirSync(fontsDest, { recursive: true });
    for (const name of fs.readdirSync(fontsSrc)) {
        const from = path.join(fontsSrc, name);
        if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(fontsDest, name));
    }
}

await esbuild.build({
    entryPoints: [path.join(root, 'client', 'plex-client', 'main.tsx')],
    bundle: true,
    outfile: path.join(outDir, 'plex-client.js'),
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    minify: true,
    sourcemap: true,
    define: {
        'process.env.PLEX_CLIENT_PORTAL_URL': JSON.stringify(injectPortal),
        'process.env.PLEX_CLIENT_APP_VERSION': JSON.stringify(appVersion),
        'process.env.PLEX_CLIENT_APP_VERSION_CODE': JSON.stringify(appVersionCode),
        'process.env.PLEX_CLIENT_TMDB_API_KEY': JSON.stringify(String(process.env.PLEX_CLIENT_TMDB_API_KEY || '').trim()),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
    nodePaths: [path.join(root, 'plex-client', 'node_modules'), path.join(root, 'node_modules')],
    loader: {
        '.png': 'file',
        '.jpg': 'file',
        '.svg': 'file',
        '.woff2': 'file',
    },
    logLevel: 'info',
});

console.log(`plex-client built → ${outDir}`);
if (appVersion) console.log(`appVersion = ${appVersion}${appVersionCode ? ` (${appVersionCode})` : ''}`);
if (injectPortal) console.log(`portalBaseUrl = ${injectPortal} (dev/sideload only)`);
else console.log('portalBaseUrl empty — Play Store / multi-tenant: user enters their StreamPilot URL');
