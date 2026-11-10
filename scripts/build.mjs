import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'build/task');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tasks/PoofInstall/tsconfig.json'], { cwd: root, stdio: 'inherit' });
for (const filename of ['install_poof.sh', 'install_packages.sh', 'task.json', 'package.json']) {
    cpSync(path.join(root, 'tasks/PoofInstall', filename), path.join(output, filename));
}
