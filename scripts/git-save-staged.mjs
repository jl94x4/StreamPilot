import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const msgPath = join(process.cwd(), '.git', 'SAVE_MSG.txt');
if (!existsSync(msgPath)) {
    console.error('Missing .git/SAVE_MSG.txt with subject on line 1 and optional body after blank line.');
    process.exit(1);
}

const message = readFileSync(msgPath, 'utf8').replace(/\r\n/g, '\n').trimEnd();
const tree = execSync('git write-tree').toString().trim();
const parent = execSync('git rev-parse HEAD').toString().trim();
const tmp = join(process.cwd(), '.git', 'SAVE_MSG_TMP.txt');
writeFileSync(tmp, message, 'utf8');
try {
    const newRef = execSync(`git commit-tree ${tree} -p ${parent} -F "${tmp}"`).toString().trim();
    execSync(`git update-ref HEAD ${newRef}`);
    execSync('git reset HEAD');
    process.stdout.write(execSync('git log -1 --format=full').toString());
} finally {
    try { unlinkSync(tmp); } catch {}
}
