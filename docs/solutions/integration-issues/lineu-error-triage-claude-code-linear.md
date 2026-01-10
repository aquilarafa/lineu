---
title: "Lineu: CLI Server for Automated Error Triage with Claude Code"
slug: lineu-error-triage-claude-code-linear
category: integration-issues
tags:
  - claude-code-cli
  - linear-api
  - webhook-processing
  - error-triage
  - typescript
  - fastify
  - sqlite
  - child-process
  - stream-json
components:
  - claude-code
  - linear-sdk
  - better-sqlite3
  - fastify
severity: medium
date_solved: 2026-01-07
---

# Lineu: CLI Server for Automated Error Triage

## Overview

**Lineu** is a CLI server that automates error triage by:
1. Receiving webhooks with JSON payloads
2. Running Claude Code CLI for contextual analysis
3. Creating Linear issues with detailed analysis
4. Deduplicating errors via SHA256 fingerprinting

## Problems Solved

| Problem | Root Cause | Solution |
|---------|------------|----------|
| Claude Code CLI hanging | stdin not closed | `stdio: ['ignore', 'pipe', 'pipe']` |
| Claude taking too long | max turns too low (default 3) | Increased to 20 turns |
| Claude not producing JSON | Prompt too vague | Directive prompt with 5-search limit |
| Linear team ID validation | Using key instead of UUID | Team key resolution via `teams()` API |

---

## Problem 1: Claude Code CLI Hanging

### Symptoms
- Claude Code process would start but never complete
- No output was produced
- The worker would hang indefinitely

### Root Cause
When spawning Claude Code from Node.js, stdin was left open by default. Claude detected this and entered interactive mode, waiting for input.

### Solution

Set `stdio: ['ignore', 'pipe', 'pipe']` to close stdin:

```typescript
// src/services/claude.ts
const proc = spawn('claude', [
  '-p', prompt,
  '--output-format', 'stream-json',
  '--max-turns', String(this.maxTurns),
  '--verbose',
], {
  cwd: repoPath,
  stdio: ['ignore', 'pipe', 'pipe'], // Close stdin, pipe stdout/stderr
});
```

**Key insight**: The first element `'ignore'` closes stdin, preventing Claude from waiting for interactive input.

---

## Problem 2: Max Turns Too Low

### Symptoms
- Claude exits with `error_max_turns`
- Analysis incomplete, no JSON output

### Root Cause
Default 3 turns insufficient for codebase analysis (search + read files + produce JSON).

### Solution

```bash
# .env
LINEU_CLAUDE_MAX_TURNS=20
```

---

## Problem 3: Prompt Too Vague

### Symptoms
- Claude investigates indefinitely
- Never produces final JSON output

### Root Cause
No limits on investigation depth. Claude's thoroughness meant endless searching.

### Solution

Directive prompt with explicit limits:

```typescript
// src/services/claude.ts
private buildPrompt(payload: Record<string, unknown>): string {
  return `You are a production error analyzer. Analyze quickly and respond ONLY with JSON.

## Error Payload

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

## IMPORTANT Instructions

IMPORTANT: You have at MOST 5 searches to investigate. After that, you MUST respond with JSON.

1. Do 1-2 quick searches (grep/glob) to locate relevant files
2. Read at most 2-3 key files
3. IMMEDIATELY respond with the JSON below

DO NOT continue investigating indefinitely. Make a quick hypothesis based on what you found.

## REQUIRED Response (JSON)

\`\`\`json
{
  "category": "bug|infrastructure|database|external-service|configuration|performance",
  "priority": "critical|high|medium|low",
  "summary": "Short description (max 80 chars)",
  "affected_files": ["path/to/file.rb"],
  "root_cause_hypothesis": "Probable cause",
  "suggested_fix": "How to fix",
  "investigation_steps": ["Step 1", "Step 2"],
  "related_code": "Relevant snippet"
}
\`\`\`

RESPOND ONLY WITH THE JSON ABOVE. No additional text.`;
}
```

**Key insights**:
- Explicit search limits ("at MOST 5 searches")
- Permission to hypothesize ("Make a quick hypothesis")
- Strong directive language ("MUST respond", "ONLY with JSON")

---

## Problem 4: Linear Team ID Not UUID

### Symptoms
- Error: `"teamId must be a UUID"`
- Issue creation failed

### Root Cause
Linear's `createIssue` requires UUID, but users configure team key (e.g., "ENG").

### Solution

Add `getTeamId()` that resolves key via `teams()` API:

```typescript
// src/services/linear.ts
private async getTeamId(): Promise<string> {
  if (this.resolvedTeamId) {
    return this.resolvedTeamId;
  }

  // Check if it's already a UUID
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(this.teamIdOrKey)) {
    this.resolvedTeamId = this.teamIdOrKey;
    return this.resolvedTeamId;
  }

  // Look up team by key
  const teams = await this.client.teams();
  const team = teams.nodes.find(t => t.key === this.teamIdOrKey);
  if (!team) {
    throw new Error(`Team not found with key: ${this.teamIdOrKey}`);
  }

  this.resolvedTeamId = team.id;
  console.log(`[Linear] Resolved team key "${this.teamIdOrKey}" to ID: ${this.resolvedTeamId}`);
  return this.resolvedTeamId;
}
```

---

## Prevention Strategies

### Best Practices Checklist

**Claude Code CLI Integration**:
- [ ] Always close stdin: `stdio: ['ignore', 'pipe', 'pipe']`
- [ ] Use `--output-format stream-json` for structured output
- [ ] Set explicit `--max-turns` based on task complexity
- [ ] Implement manual timeout with `setTimeout` + `proc.kill()`
- [ ] Log all sessions for debugging

**External API Integration**:
- [ ] Validate ID formats before API calls
- [ ] Add fallback resolution mechanisms (key → UUID)
- [ ] Cache resolved IDs to avoid repeated lookups

**Prompt Engineering for Automation**:
- [ ] Set explicit investigation limits
- [ ] Use directive language ("MUST", "IMMEDIATELY")
- [ ] Provide clear output templates with required fields
- [ ] Give permission to hypothesize with incomplete data

### Common Pitfalls

| Pitfall | Why It Happens | Prevention |
|---------|----------------|------------|
| Process hangs | stdin left open | Always set `stdio[0] = 'ignore'` |
| Timeout doesn't work | Using spawn's timeout option | Implement manual `setTimeout` |
| Endless investigation | Open-ended prompt | Set explicit search limits |
| API validation errors | Assuming ID formats | Validate and resolve IDs |

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                         Lineu                              │
│                                                            │
│  ┌──────────┐         ┌──────────┐         ┌───────┐      │
│  │ Webhook  │────────▶│ Claude   │────────▶│Linear │      │
│  │ Server   │         │ Code CLI │         │  API  │      │
│  └──────────┘         └──────────┘         └───────┘      │
│       │                     │                              │
│       ▼                     ▼                              │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                SQLite (Jobs + Fingerprints)           │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

---

## Related Links

- [Claude Code Documentation](https://claude.com/claude-code)
- [Linear API](https://developers.linear.app/docs/graphql/working-with-the-graphql-api)
- [Fastify](https://www.fastify.io/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
