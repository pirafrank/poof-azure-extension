import * as task from 'azure-pipelines-task-lib/task';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';

function getInstallDir(): string {
    return path.join(os.homedir(), '.local', 'bin');
}

function getPoofBinDir(): string {
    if (os.platform() === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'poof', 'bin');
    }
    return path.join(os.homedir(), '.local', 'share', 'poof', 'bin');
}

function run(): void {
    try {
        const version: string       = task.getInput('version')      || 'latest';
        const packages: string      = task.getInput('packages')     || '';
        const githubToken: string   = task.getInput('githubToken')  || '';

        const installDir: string  = getInstallDir();
        const poofBinDir: string  = getPoofBinDir();

        fs.mkdirSync(installDir, { recursive: true });
        fs.mkdirSync(poofBinDir, { recursive: true });

        task.debug(`poof install dir : ${installDir}`);
        task.debug(`poof bin dir     : ${poofBinDir}`);

        // Base environment passed to both subprocesses
        const baseEnv: NodeJS.ProcessEnv = {
            ...process.env,
            POOF_INSTALL_DIR: installDir,
            POOF_VERSION: version,
            GITHUB_TOKEN: githubToken,
            // Ensure the install dir is in PATH for any child processes
            PATH: `${installDir}:${process.env.PATH || ''}`,
        };

        // Install poof
        const installScript = path.join(__dirname, 'install_poof.sh');
        task.debug(`Running install script: ${installScript}`);

        const installResult = spawnSync('bash', [installScript], {
            env: baseEnv,
            stdio: 'inherit',
        });

        if (installResult.error) {
            throw installResult.error;
        }
        if (installResult.status !== 0) {
            throw new Error(`poof installation failed with exit code ${installResult.status}`);
        }

        // Prepend both directories to PATH for all subsequent pipeline steps
        task.prependPath(installDir);
        task.prependPath(poofBinDir);

        // Optionally install packages
        if (packages.trim()) {
            const packagesScript = path.join(__dirname, 'install_packages.sh');
            task.debug(`Running packages script: ${packagesScript}`);

            const packagesResult = spawnSync('bash', [packagesScript], {
                env: {
                    ...baseEnv,
                    POOF_PACKAGES: packages,
                    // Include poofBinDir so packages installed in this step are also findable
                    PATH: `${installDir}:${poofBinDir}:${process.env.PATH || ''}`,
                },
                stdio: 'inherit',
            });

            if (packagesResult.error) {
                throw packagesResult.error;
            }
            if (packagesResult.status !== 0) {
                throw new Error(`Package installation failed with exit code ${packagesResult.status}`);
            }
        }

        task.setResult(task.TaskResult.Succeeded, 'poof setup complete');
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        task.setResult(task.TaskResult.Failed, message);
    }
}

run();
