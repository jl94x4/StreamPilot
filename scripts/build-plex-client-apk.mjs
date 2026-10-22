/**
 * Bump Android app version, build web assets, sync Capacitor, assemble the APK,
 * copy to Desktop as SMP-Media-Player-debug.apk (or -release.apk).
 *
 * Usage (repo root): npm run build:apk
 *                    npm run build:apk:release   (signed with plex-client/android/keystore.properties)
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

const release = process.argv.includes('--release');
const androidDir = path.join(root, 'plex-client', 'android');
const keystorePropsPath = path.join(androidDir, 'keystore.properties');

// Check the key before bumping the version, so a missing key does not burn a versionCode.
if (release) {
    const props = fs.existsSync(keystorePropsPath) ? fs.readFileSync(keystorePropsPath, 'utf8') : '';
    const storeFile = (props.match(/^\s*storeFile\s*=\s*(.+?)\s*$/m) || [])[1] || '';
    const missing = ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']
        .filter((key) => !new RegExp(`^\\s*${key}\\s*=\\s*\\S`, 'm').test(props));
    const storePath = storeFile ? path.resolve(androidDir, storeFile) : '';
    if (!props || missing.length || !fs.existsSync(storePath)) {
        console.error(
            '\nRelease signing is not set up.\n'
            + (props ? '' : `  Missing ${keystorePropsPath}\n`)
            + (props && missing.length ? `  keystore.properties is missing: ${missing.join(', ')}\n` : '')
            + (props && !missing.length && !fs.existsSync(storePath) ? `  Keystore not found: ${storePath}\n` : '')
            + '  1. Create a key:  keytool -genkeypair -v -keystore "%USERPROFILE%\\.android\\smp-release.jks"'
            + ' -alias smp -keyalg RSA -keysize 4096 -validity 10000\n'
            + '  2. Copy plex-client/android/keystore.properties.example to keystore.properties and fill it in.\n',
        );
        process.exit(1);
    }
}

const node = process.execPath;
run(node, [path.join('scripts', 'bump-plex-client-version.mjs')]);

const whatsNewPath = path.join(root, 'client', 'plex-client', 'ApkWhatsNew.tsx');
const whatsNewSrc = fs.existsSync(whatsNewPath) ? fs.readFileSync(whatsNewPath, 'utf8') : '';
const notesVersions = [...whatsNewSrc.matchAll(/^\s+'(\d+\.\d+\.\d+)':\s*\[/gm)]
    .map((match) => match[1]);
const gradleAfterBump = fs.readFileSync(
    path.join(root, 'plex-client', 'android', 'app', 'build.gradle'),
    'utf8',
);
const bumpedVersion = (gradleAfterBump.match(/versionName\s+"([^"]+)"/) || [])[1] || '?';
const newestNotesVersion = notesVersions[0] || '';
if (!newestNotesVersion || !whatsNewSrc.includes('items:')) {
    console.warn(
        `\n⚠  NOTES_BY_VERSION in client/plex-client/ApkWhatsNew.tsx looks empty.\n`
        + `   Add notes under the newest patch keys (current, current-1, current-2)\n`
        + `   so What's New can show the last 10 versions in sequence.\n`,
    );
} else {
    console.log(
        `What's New: newest notes key ${newestNotesVersion} `
        + `(app ${bumpedVersion}; keep the last 10 patch keys populated)`,
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

// `.\` — with NoDefaultCurrentDirectoryInExePath set, cmd does not search cwd.
const gradleTask = release ? 'assembleRelease' : 'assembleDebug';
run(isWin ? 'gradlew.bat' : './gradlew', [gradleTask], {
    cwd: androidDir,
    shellCommand: isWin ? `.\\gradlew.bat ${gradleTask}` : undefined,
});

const variant = release ? 'release' : 'debug';
const apkSrc = path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
const desktop = process.env.USERPROFILE || process.env.HOME || root;
const apkDest = path.join(desktop, 'Desktop', `SMP-Media-Player-${variant}.apk`);
fs.copyFileSync(apkSrc, apkDest);

const gradle = fs.readFileSync(path.join(plexClient, 'android', 'app', 'build.gradle'), 'utf8');
const versionName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '?';
const versionCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1] || '?';
const stat = fs.statSync(apkDest);
console.log(`APK ${versionName} (${versionCode}) → ${apkDest} (${stat.size} bytes)`);
