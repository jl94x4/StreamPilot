/**
 * Bump Android app version, build web assets, sync Capacitor, assemble debug APK,
 * copy to Desktop as SMP-Media-Player-debug.apk.
 *
 * Usage (repo root): npm run build:apk
 * Env: JAVA_HOME should point at a JDK 17+ install on Windows.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

const run = (command, args = [], opts = {}) => {
    const result = isWin && opts.shellCommand
        ? spawnSync(opts.shellCommand, {
            cwd: opts.cwd || root,
            stdio: 'inherit',
            shell: true,
            env: process.env,
        })
        : spawnSync(command, args, {
            cwd: opts.cwd || root,
            stdio: 'inherit',
            shell: false,
            env: process.env,
        });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
};

const node = process.execPath;
run(node, [path.join('scripts', 'bump-plex-client-version.mjs')]);

const whatsNewPath = path.join(root, 'client', 'plex-client', 'ApkWhatsNew.tsx');
const whatsNewSrc = fs.existsSync(whatsNewPath) ? fs.readFileSync(whatsNewPath, 'utf8') : '';
const currentNotesMatch = whatsNewSrc.match(
    /const CURRENT_RELEASE_NOTES: WhatsNewSection\[\] = \[([\s\S]*?)\];/,
);
const currentNotesBody = currentNotesMatch ? currentNotesMatch[1].trim() : '';
if (!currentNotesBody || currentNotesBody === '[]' || !currentNotesBody.includes('items:')) {
    console.warn(
        `\n⚠  CURRENT_RELEASE_NOTES in client/plex-client/ApkWhatsNew.tsx looks empty.\n`
        + `   Update it when shipping user-facing changes — What's New uses that block,\n`
        + `   not the auto-bumped versionName.\n`,
    );
} else {
    const gradleAfterBump = fs.readFileSync(
        path.join(root, 'plex-client', 'android', 'app', 'build.gradle'),
        'utf8',
    );
    const bumpedVersion = (gradleAfterBump.match(/versionName\s+"([^"]+)"/) || [])[1] || '?';
    console.log(
        `What's New: CURRENT_RELEASE_NOTES will show under ${bumpedVersion} `
        + `(update that block when features change)`,
    );
}

run('npm', ['run', 'build:css'], { shellCommand: isWin ? 'npm run build:css' : undefined });
run('npm', ['run', 'build:plex-client'], { shellCommand: isWin ? 'npm run build:plex-client' : undefined });

// tar@7 (security override) breaks Capacitor's tar.default.extract during sync.
run(node, [path.join('scripts', 'patch-capacitor-tar.mjs')]);

const plexClient = path.join(root, 'plex-client');
run('npx', ['cap', 'sync', 'android'], {
    cwd: plexClient,
    shellCommand: isWin ? 'npx cap sync android' : undefined,
});

const androidDir = path.join(plexClient, 'android');
run(isWin ? 'gradlew.bat' : './gradlew', ['assembleDebug'], {
    cwd: androidDir,
    shellCommand: isWin ? 'gradlew.bat assembleDebug' : undefined,
});

const apkSrc = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const desktop = process.env.USERPROFILE || process.env.HOME || root;
const apkDest = path.join(desktop, 'Desktop', 'SMP-Media-Player-debug.apk');
fs.copyFileSync(apkSrc, apkDest);

const gradle = fs.readFileSync(path.join(plexClient, 'android', 'app', 'build.gradle'), 'utf8');
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '?';
const versionCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1] || '?';
const stat = fs.statSync(apkDest);
console.log(`APK ${versionName} (${versionCode}) → ${apkDest} (${stat.size} bytes)`);
