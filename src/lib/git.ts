import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

function injectGithubToken(url: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return url;

  // Only inject for HTTPS GitHub URLs
  if (url.startsWith('https://github.com/')) {
    return url.replace('https://github.com/', `https://${token}@github.com/`);
  }
  return url;
}

export async function cloneRepository(repoUrl: string, targetDir?: string): Promise<string> {
  // Inject GitHub token for private repos
  const authUrl = injectGithubToken(repoUrl);

  // Extract repo name from URL for default directory
  const repoName = repoUrl
    .replace(/\.git$/, '')
    .split('/')
    .pop() || 'repo';

  // Use provided target or create in ~/.lineu/repos/
  const baseDir = targetDir || path.join(os.homedir(), '.lineu', 'repos');
  const repoPath = path.join(baseDir, repoName);

  // Create base directory if needed
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  // If repo already exists, just pull
  if (fs.existsSync(path.join(repoPath, '.git'))) {
    console.log(`Repository already exists at ${repoPath}, pulling latest...`);
    await gitPull(repoPath);
    return repoPath;
  }

  console.log(`Cloning ${repoUrl} to ${repoPath}...`);

  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['clone', authUrl, repoPath], {
      stdio: 'inherit',
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to clone: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git clone exited with code ${code}`));
      } else {
        console.log(`Cloned successfully to ${repoPath}`);
        resolve(repoPath);
      }
    });
  });
}

function gitPull(repoPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['-C', repoPath, 'pull', '--ff-only'], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn('Git pull failed, continuing with current state');
      }
      resolve();
    });

    proc.on('error', () => resolve());
  });
}
