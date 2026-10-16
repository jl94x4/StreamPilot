import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const clone = (value) => structuredClone(value);

export const createAtomicJsonStore = ({ filePath, defaultValue = {} } = {}) => {
    const target = path.resolve(String(filePath || ''));
    if (!filePath) throw new Error('[media-automation/store] filePath is required');
    let chain = Promise.resolve();

    const serialize = (operation) => {
        const current = chain.then(operation, operation);
        chain = current.catch(() => {});
        return current;
    };

    const readUnsafe = async () => {
        try {
            return JSON.parse(await fs.readFile(target, 'utf8'));
        } catch (error) {
            if (error?.code === 'ENOENT') return clone(defaultValue);
            throw error;
        }
    };

    const writeUnsafe = async (value) => {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
            await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            await fs.rename(temporary, target);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => {});
        }
        return clone(value);
    };

    return {
        filePath: target,
        read: () => serialize(async () => clone(await readUnsafe())),
        write: (value) => serialize(() => writeUnsafe(clone(value))),
        update: (mutator) => serialize(async () => {
            const current = await readUnsafe();
            const result = await mutator(clone(current));
            const next = result === undefined ? current : result;
            await writeUnsafe(next);
            return clone(next);
        }),
    };
};

export default createAtomicJsonStore;
