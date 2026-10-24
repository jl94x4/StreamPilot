#!/usr/bin/env node
/**
 * Build the portal-backed Media Player web assets into plex-client/dist
 * for Capacitor (phone + Android TV).
 */
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'plex-client', 'dist');
const require = createRequire(import.meta.url);

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
    .replace('__APP_VERSION__', appVersion || '')
    .replace('./tailwind.css"', `./tailwind.css?v=${assetStamp}"`)
    .replace('./plex-client.js"', `./plex-client.js?v=${assetStamp}"`);
fs.writeFileSync(path.join(outDir, 'index.html'), injected);

const logoSrc = path.join(root, 'static', 'logo.png');
if (fs.existsSync(logoSrc)) {
    fs.copyFileSync(logoSrc, path.join(outDir, 'logo.png'));
}

// Bundled network wordmarks (Channel 4, ITV, Sky, …) for TV billboards.
const logosSrc = path.join(root, 'static', 'logos');
const logosDest = path.join(outDir, 'static', 'logos');
if (fs.existsSync(logosSrc)) {
    fs.mkdirSync(logosDest, { recursive: true });
    for (const name of fs.readdirSync(logosSrc)) {
        const from = path.join(logosSrc, name);
        if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(logosDest, name));
    }
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

// Code split: languages, hls.js and html2canvas load on demand, so a slow stick parses
// far less before Home. Chunks are content-hashed; clear old ones first.
fs.rmSync(path.join(outDir, 'chunks'), { recursive: true, force: true });
const bundle = await esbuild.build({
    entryPoints: { 'plex-client': path.join(root, 'client', 'plex-client', 'main.tsx') },
    bundle: true,
    outdir: outDir,
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: '[name]-[hash]',
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    minify: true,
    sourcemap: true,
    metafile: true,
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

/**
 * The app's own stylesheet: Tailwind scans only the files in the bundle above (not the whole
 * portal), then it is minified. About a third smaller, with fewer rules for the browser to
 * match on every change. Falls back to the portal build if this fails.
 */
const twDest = path.join(outDir, 'tailwind.css');
try {
    const loadConfig = require('tailwindcss/loadConfig');
    const tailwindcss = require('tailwindcss');
    const postcss = require('postcss');
    const content = Object.keys(bundle.metafile.inputs)
        .filter((file) => !file.includes('node_modules') && /\.(?:t|j)sx?$/.test(file))
        .map((file) => path.join(root, file));
    content.push(path.join(root, 'plex-client', 'index.html'));
    const config = { ...loadConfig(path.join(root, 'tailwind.config.js')), content };
    const inputCss = path.join(root, 'input.css');
    const built = await postcss([tailwindcss(config)]).process(fs.readFileSync(inputCss, 'utf8'), { from: inputCss });
    const { code } = await esbuild.transform(built.css, { loader: 'css', minify: true });
    fs.writeFileSync(twDest, code);
    console.log(`app stylesheet → ${Math.round(code.length / 1024)}KB from ${content.length} files`);
} catch (err) {
    const twSrc = path.join(root, 'static', 'tailwind.css');
    console.warn(`app stylesheet failed (${err?.message || err}); using the portal build`);
    if (fs.existsSync(twSrc)) fs.copyFileSync(twSrc, twDest);
    else fs.writeFileSync(twDest, '/* tailwind build skipped */\nbody{font-family:system-ui,sans-serif}\n');
}

console.log(`plex-client built → ${outDir}`);
if (appVersion) console.log(`appVersion = ${appVersion}${appVersionCode ? ` (${appVersionCode})` : ''}`);
if (injectPortal) console.log(`portalBaseUrl = ${injectPortal} (dev/sideload only)`);
else console.log('portalBaseUrl empty — Play Store / multi-tenant: user enters their StreamPilot URL');
