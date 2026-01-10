# Lineu - Error Triage System

Automates error triage: webhook → Claude CLI analysis → Linear issue.

## Stack

TypeScript, Fastify, better-sqlite3, @linear/sdk, Claude CLI

## Structure

```
src/
├── index.ts      # CLI entry point (serve, test, stats)
├── server.ts     # Fastify endpoints
├── worker.ts     # Job processor (polls every 10s)
├── db.ts         # SQLite (~/.lineu/lineu.db)
├── types.ts      # Type definitions
├── lib/          # Utilities (config, fingerprint, git)
├── services/     # Integrations (claude, linear, newrelic)
└── prompts/      # Prompt templates
```

## Development

```bash
npm install       # Install dependencies
npm run build     # Compile TypeScript
npm run dev       # Development mode
```

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for Docker/server deploy (optional locally)
- `LINEAR_API_KEY` - Required to create issues
- `DASHBOARD_USER` / `DASHBOARD_PASS` - Dashboard authentication

## Main Commands

```bash
lineu serve --repo /path/to/repo    # Start webhook server
lineu test --repo /path --dry-run   # Test analysis locally
lineu stats                         # View job statistics
```

## Documentation

- [docs/architecture.md](docs/architecture.md) - Diagram and processing flow
- [docs/cli-usage.md](docs/cli-usage.md) - All command details
- [docs/configuration.md](docs/configuration.md) - Configuration and environment variables
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Docker deployment
