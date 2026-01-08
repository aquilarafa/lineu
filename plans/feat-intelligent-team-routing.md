# feat: Intelligent Team Routing for Linear Issues

**Date**: 2026-01-07
**Type**: Enhancement
**Status**: Ready for Implementation

## Overview

Enhance Lineu to intelligently route issues to the appropriate Linear team based on Claude's analysis. Currently all issues go to a single configured team (`LINEAR_TEAM_ID`). This feature lets Claude suggest the best team based on affected files, error category, and context.

## Problem

- Payment errors going to Platform team (wrong expertise)
- Database issues going to Mobile team (wrong domain)
- Manual reassignment wastes time

## Solution

1. Fetch all Linear teams at startup
2. Include team list in Claude's prompt
3. Claude suggests the best team (or null if uncertain)
4. Validate team exists, fallback to default if not
5. Create issue in resolved team

**Backward compatible**: `LINEAR_TEAM_ID` becomes the fallback team.

## Implementation

### 1. Add TeamInfo type

**File**: `src/types.ts`

```typescript
export interface TeamInfo {
  id: string;
  key: string;
  name: string;
}
```

### 2. Extend ClaudeAnalysis

**File**: `src/types.ts`

```typescript
export interface ClaudeAnalysis {
  // ... existing fields
  suggested_team: string | null;  // Team key like "ENG" or null if uncertain
}
```

### 3. Add team methods to LinearService

**File**: `src/services/linear.ts`

```typescript
export class LinearService {
  private client: LinearClient;
  private defaultTeamKey: string;
  private teams: Map<string, TeamInfo> = new Map();  // key -> team

  constructor(config: { apiKey: string; defaultTeamId: string }) {
    this.client = new LinearClient({ apiKey: config.apiKey });
    this.defaultTeamKey = config.defaultTeamId;
  }

  async fetchTeams(): Promise<{ success: boolean; count: number }> {
    try {
      const result = await this.client.teams({ first: 100 });
      for (const team of result.nodes) {
        this.teams.set(team.key, {
          id: team.id,
          key: team.key,
          name: team.name,
        });
      }
      console.log(`[Linear] Loaded ${result.nodes.length} teams`);
      return { success: true, count: result.nodes.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.warn(`[Linear] Failed to fetch teams: ${msg}. Using default team only.`);
      return { success: false, count: 0 };
    }
  }

  getTeamListForPrompt(): string {
    if (this.teams.size === 0) return '';
    return Array.from(this.teams.values())
      .map(t => `- ${t.key}: ${t.name}`)
      .join('\n');
  }

  resolveTeamId(suggestedKey: string | null): string {
    if (!suggestedKey) {
      return this.getDefaultTeamId();
    }
    const team = this.teams.get(suggestedKey);
    if (team) {
      return team.id;
    }
    console.warn(`[Linear] Team "${suggestedKey}" not found, using default`);
    return this.getDefaultTeamId();
  }

  private getDefaultTeamId(): string {
    // Try to resolve default from cache, otherwise use as-is (might be UUID)
    const team = this.teams.get(this.defaultTeamKey);
    return team?.id || this.defaultTeamKey;
  }

  async createIssue(
    teamId: string,
    payload: Record<string, unknown>,
    analysis: ClaudeAnalysis,
    fingerprint: string
  ): Promise<LinearIssue> {
    // ... existing implementation, but use passed teamId
  }
}
```

### 4. Update Claude prompt

**File**: `src/services/claude.ts`

```typescript
async analyze(
  repoPath: string,
  payload: Record<string, unknown>,
  jobId?: number,
  teamList?: string  // NEW parameter
): Promise<ClaudeAnalysis> {
  const prompt = this.buildPrompt(payload, teamList);
  // ... rest unchanged
}

private buildPrompt(payload: Record<string, unknown>, teamList?: string): string {
  const teamSection = teamList ? `
## Times Disponíveis

${teamList}

Para escolher o time:
1. Se encontrar CODEOWNERS, use o owner dos arquivos afetados
2. Se não, escolha baseado no contexto do erro
3. Se incerto, retorne null
` : '';

  return `Você é um analisador de erros de produção. Analise rapidamente e responda APENAS com JSON.

## Payload do Erro

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
${teamSection}
## Instruções

IMPORTANTE: Você tem no MÁXIMO 5 buscas. Após isso, DEVE responder com JSON.

1. Faça 1-2 buscas rápidas (grep/glob) para localizar arquivos relevantes
2. Se existir CODEOWNERS, leia para entender ownership
3. Leia no máximo 2-3 arquivos chave
4. Responda com o JSON abaixo

## Resposta (JSON)

\`\`\`json
{
  "category": "bug|infrastructure|database|external-service|configuration|performance",
  "priority": "critical|high|medium|low",
  "summary": "Descrição curta (max 80 chars)",
  "affected_files": ["caminho/arquivo.ts"],
  "root_cause_hypothesis": "Causa provável",
  "suggested_fix": "Como resolver",
  "investigation_steps": ["Passo 1", "Passo 2"],
  "related_code": "Snippet relevante",
  "suggested_team": "TEAM_KEY ou null se incerto"
}
\`\`\``;
}
```

### 5. Wire up in worker

**File**: `src/worker.ts`

```typescript
async function processJob(...) {
  // ... existing duplicate check

  // Get team context
  const teamList = linear.getTeamListForPrompt();

  // Execute Claude with team context
  const analysis = await claude.analyze(config.repo.path, payload, job.id, teamList);

  // Resolve team
  const teamId = linear.resolveTeamId(analysis.suggested_team);

  // Create issue
  const issue = await linear.createIssue(teamId, payload, analysis, job.fingerprint);

  // ... existing fingerprint/completion logic
}
```

### 6. Initialize at startup

**File**: `src/index.ts`

```typescript
// In serve command, before starting worker:
await linear.fetchTeams();
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/types.ts` | Add `TeamInfo`, add `suggested_team` to `ClaudeAnalysis` |
| `src/services/linear.ts` | Add `fetchTeams()`, `getTeamListForPrompt()`, `resolveTeamId()` |
| `src/services/claude.ts` | Accept `teamList` param, update prompt |
| `src/worker.ts` | Pass team list to Claude, resolve team before issue creation |
| `src/index.ts` | Call `fetchTeams()` at startup |
| `src/lib/config.ts` | Rename `teamId` to `defaultTeamId` (optional, for clarity) |

## Acceptance Criteria

- [ ] Teams fetched at startup (failure = warning, not crash)
- [ ] Claude prompt includes team list when available
- [ ] `suggested_team` field parsed from Claude response
- [ ] Issues created in suggested team when valid
- [ ] Falls back to `LINEAR_TEAM_ID` when suggestion is null or invalid
- [ ] Existing config continues working (backward compatible)

## Estimated Effort

~30-40 lines of code changes across 5 files.

---

*Simplified based on DHH, Kieran, and Simplicity reviews.*
