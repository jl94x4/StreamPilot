/**
 * Capacitor CLI 6 uses `tar.default.extract`, but npm override tar@7 has no
 * default export — `cap sync` then fails mid-update and wipes cordova plugins.
 * Patch node_modules once before sync (idempotent).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateJs = path.join(root, 'node_modules', '@capacitor', 'cli', 'dist', 'util', 'template.js');
if (!fs.existsSync(templateJs)) {
    console.warn('patch-capacitor-tar: template.js not found — skip');
    process.exit(0);
}
let src = fs.readFileSync(templateJs, 'utf8');
if (src.includes('tar_1.default || tar_1')) {
    process.exit(0);
}
if (!src.includes('tar_1.default.extract')) {
    console.warn('patch-capacitor-tar: unexpected template.js — skip');
    process.exit(0);
}
src = src.replace(
    /await \(0, utils_fs_1\.mkdirp\)\(dir\);\s*await tar_1\.default\.extract\(\{ file: src, cwd: dir \}\);/,
    `await (0, utils_fs_1.mkdirp)(dir);
    const tarApi = tar_1.default || tar_1;
    await tarApi.extract({ file: src, cwd: dir });`,
);
fs.writeFileSync(templateJs, src, 'utf8');
console.log('patch-capacitor-tar: patched @capacitor/cli for tar@7');
