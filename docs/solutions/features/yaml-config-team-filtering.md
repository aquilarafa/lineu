---
title: YAML Config File Support for Team Filtering
category: features
tags: [configuration, yaml, linear, teams]
date: 2026-01-09
component: config
commit: 5eb846a
---

# YAML Config File Support for Team Filtering

## Problem

Before this feature, Lineu used all active Linear teams when Claude suggested a team to route the issue. In organizations with many teams, this caused:

1. **Suggestion noise**: Claude could suggest irrelevant teams
2. **Lack of control**: No way to limit which teams could receive automated issues
3. **Inflexible configuration**: Any change required code modifications

## Solution

We added support for a YAML config file at `~/.lineu/config.yml` that filters which Linear teams Claude can suggest.

```yaml
# ~/.lineu/config.yml
teams:
  - ENG
  - INFRA
  - PRODUCT
```

## Implementation Details

### 1. Config Loading (`src/lib/config.ts`)

The `loadConfigFile` function loads and validates the YAML:

```typescript
export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), '.lineu', 'config.yml');
}

export function loadConfigFile(configPath?: string, isExplicit = false): string[] | null {
  const filePath = configPath || getDefaultConfigPath();
  const expandedPath = filePath.startsWith('~/')
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;

  try {
    const content = fs.readFileSync(expandedPath, 'utf8');
    const parsed = yaml.load(content, { filename: expandedPath }) as ConfigFile;

    if (parsed?.teams && Array.isArray(parsed.teams)) {
      if (parsed.teams.every(t => typeof t === 'string')) {
        console.log(`[Config] Loaded from ${expandedPath}`);
        return parsed.teams;
      }
      throw new Error('teams must be an array of strings');
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (isExplicit) {
        throw new Error(`Config file not found: ${expandedPath}`);
      }
      return null; // Silent fallback for default path
    }
    throw error;
  }
}
```

**Error behavior:**
- Config at default path doesn't exist → silently uses all teams
- Config specified via `--config` doesn't exist → explicit error
- Malformed YAML → error with parser message

### 2. Team Filtering (`src/services/linear.ts`)

`LinearService` filters teams during fetch:

```typescript
export class LinearService {
  private allowedTeamKeys: Set<string> | null = null;

  setAllowedTeams(keys: string[]): void {
    this.allowedTeamKeys = new Set(keys);
    console.log(`[Linear] Filtering to teams: ${keys.join(', ')}`);
  }

  async fetchTeams(): Promise<{ success: boolean; count: number }> {
    const result = await this.client.teams({ first: 100 });

    for (const team of result.nodes) {
      // Skip teams not in allowlist
      if (this.allowedTeamKeys && !this.allowedTeamKeys.has(team.key)) {
        continue;
      }
      this.teams.set(team.key, { id: team.id, key: team.key, name: team.name });
    }

    // Warn about configured but missing teams
    if (this.allowedTeamKeys) {
      for (const key of this.allowedTeamKeys) {
        if (!this.teams.has(key)) {
          console.warn(`[Linear] Team "${key}" not found or deactivated`);
        }
      }
    }

    return { success: true, count: this.teams.size };
  }
}
```

### 3. CLI Integration (`src/index.ts`)

New `--config` option in `serve` and `test` commands:

```typescript
.option('-c, --config <path>', 'Config file path', getDefaultConfigPath())
```

Integration at startup:

```typescript
const configPath = options.config;
const isExplicitConfig = process.argv.includes('--config') || process.argv.includes('-c');
const allowedTeams = loadConfigFile(configPath, isExplicitConfig);

if (allowedTeams) {
  linear.setAllowedTeams(allowedTeams);
}
```

## Usage

### Basic Usage

Create `~/.lineu/config.yml`:

```yaml
teams:
  - ENG
  - INFRA
```

Run normally:

```bash
lineu serve --repo /path/to/repo
# [Config] Loaded from /Users/you/.lineu/config.yml
# [Linear] Filtering to teams: ENG, INFRA
```

### Custom Config Path

```bash
lineu serve --repo /path/to/repo --config ./my-config.yml
```

### No Config (All Teams)

If the file doesn't exist at the default path, all teams are used:

```bash
lineu serve --repo /path/to/repo
# [Linear] Loaded 15 teams
```

## Key Decisions

1. **YAML over JSON**: More readable for human configuration, supports comments
2. **Default path at ~/.lineu/**: Centralizes all Lineu configuration
3. **Silent fallback**: Missing config at default path is not an error
4. **Explicit config is required**: Config specified via `--config` must exist
5. **Warning for missing teams**: Configured but not found teams generate warning, not error

## Dependencies Added

```json
{
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9"
  }
}
```
