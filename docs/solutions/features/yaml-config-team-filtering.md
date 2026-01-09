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

Antes desta feature, o Lineu usava todos os times ativos do Linear quando Claude sugeria um time para rotear o issue. Em organizações com muitos times, isso causava:

1. **Ruído na sugestão**: Claude poderia sugerir times irrelevantes
2. **Falta de controle**: Não havia como limitar quais times poderiam receber issues automatizados
3. **Configuração inflexível**: Qualquer mudança requeria alteração de código

## Solution

Implementamos suporte a arquivo de configuração YAML em `~/.lineu/config.yml` que permite filtrar quais times do Linear podem ser sugeridos pelo Claude.

```yaml
# ~/.lineu/config.yml
teams:
  - ENG
  - INFRA
  - PRODUCT
```

## Implementation Details

### 1. Config Loading (`src/lib/config.ts`)

A função `loadConfigFile` carrega e valida o YAML:

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

**Comportamento de erro:**
- Config no path default não existe → silenciosamente usa todos os times
- Config especificado via `--config` não existe → erro explícito
- YAML malformado → erro com mensagem do parser

### 2. Team Filtering (`src/services/linear.ts`)

O `LinearService` filtra times durante o fetch:

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

Nova opção `--config` nos comandos `serve` e `test`:

```typescript
.option('-c, --config <path>', 'Config file path', getDefaultConfigPath())
```

Integração no startup:

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

Crie `~/.lineu/config.yml`:

```yaml
teams:
  - ENG
  - INFRA
```

Rode normalmente:

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

Se o arquivo não existir no path default, todos os times são usados:

```bash
lineu serve --repo /path/to/repo
# [Linear] Loaded 15 teams
```

## Key Decisions

1. **YAML over JSON**: Mais legível para configuração humana, suporta comentários
2. **Default path em ~/.lineu/**: Centraliza toda configuração do Lineu
3. **Silent fallback**: Config ausente no path default não é erro
4. **Explicit config is required**: Config especificado via `--config` deve existir
5. **Warning for missing teams**: Times configurados mas não encontrados geram warning, não erro

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
