import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { API_URL } from './support';

const REPO_ROOT = resolve(__dirname, '../../..');
const DEFAULT_RESET_CMD = 'docker compose exec -T backend node dist/seed/seed.js --reset';

async function assertReachable(url: string, what: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (res.ok) return;
    throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    throw new Error(
      `${what} is not reachable at ${url} (${String(error)}). Start the stack first: make up`,
    );
  }
}

/**
 * Runs once before the suite: checks the stack is up, then resets the demo data so every run
 * starts from the seeded state (no rides, seeded driver availability and positions).
 * Set E2E_RESET_CMD to run another reset command, or to an empty string to skip the reset.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:3000';
  await assertReachable(`${API_URL}/health/ready`, 'The API');
  await assertReachable(baseURL, 'The web app');

  const resetCmd = process.env.E2E_RESET_CMD ?? DEFAULT_RESET_CMD;
  if (resetCmd.trim()) {
    execSync(resetCmd, { cwd: REPO_ROOT, stdio: 'inherit' });
  }
}
