import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfigFile } from './config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('loadConfigFile', () => {
  const testDir = path.join(os.tmpdir(), 'lineu-config-test-' + Date.now());
  const testConfigPath = path.join(testDir, 'config.yml');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('parses valid YAML config with teams array', () => {
    const configContent = `
teams:
  - platform
  - backend
  - frontend
`;
    fs.writeFileSync(testConfigPath, configContent);

    const teams = loadConfigFile(testConfigPath);

    expect(teams).toEqual(['platform', 'backend', 'frontend']);
  });

  it('throws clear error when explicit config path does not exist', () => {
    const missingPath = path.join(testDir, 'nonexistent.yml');

    expect(() => loadConfigFile(missingPath, true)).toThrow(
      `Config file not found: ${missingPath}`
    );
  });
});
