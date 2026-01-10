# Lineu

Automated error triage: webhook → Claude CLI analysis → Linear issue.

Lineu receives error alerts from monitoring tools (New Relic, Sentry, etc.), uses Claude CLI to analyze your codebase, and creates Linear issues with complete diagnosis including root cause, affected files, and fix suggestions.

## How It Works

1. **Receive** - Webhook accepts any JSON error payload
2. **Analyze** - Claude CLI investigates your codebase (grep, file reads, dependency analysis)
3. **Create** - Linear issue with structured analysis

```
Error Alert → Lineu Webhook → Claude Analysis → Linear Issue
```

## Quick Start

```bash
# Install
npm install -g lineu

# Set environment variables
export LINEAR_API_KEY=lin_api_xxxxxxxxxxxx
export DASHBOARD_USER=admin
export DASHBOARD_PASS=secret

# Start server
lineu serve --repo /path/to/your/project

# Configure webhook in New Relic/Sentry
# POST http://your-server:3000/webhook
```

## Installation

```bash
git clone https://github.com/aquilarafa/lineu.git
cd lineu
npm install
npm run build
npm link  # Makes 'lineu' available globally
```

### Requirements

- Node.js 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated
- Linear API key

## Commands

### `lineu serve`

Starts the webhook server.

```bash
lineu serve --repo /path/to/repo
lineu serve --repo-url git@github.com:org/repo.git
lineu serve --repo /path/to/repo --port 3001 --dry-run
```

| Flag | Description | Default |
|------|-------------|---------|
| `-r, --repo <path>` | Local repository path | - |
| `-u, --repo-url <url>` | Git URL to clone | - |
| `-p, --port <number>` | Server port | 3000 |
| `--dry-run` | Analyze but don't create Linear issues | false |

### `lineu test`

Tests error analysis locally.

```bash
lineu test --repo /path/to/repo --message "TypeError: undefined"
lineu test --repo /path/to/repo --file ./payload.json --dry-run
```

| Flag | Description | Default |
|------|-------------|---------|
| `-r, --repo <path>` | Local repository path | - |
| `-m, --message <msg>` | Simple error message | - |
| `-f, --file <path>` | JSON file with full payload | - |
| `--dry-run` | Don't create Linear issue | false |

### `lineu stats`

Shows job statistics.

```bash
lineu stats
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_API_KEY` | Yes | Linear API key |
| `DASHBOARD_USER` | No | Dashboard auth username |
| `DASHBOARD_PASS` | No | Dashboard auth password |

### Config File

Optional team filtering via `~/.lineu/config.yml`:

```yaml
teams:
  - ENG
  - INFRA
  - BACKEND
```

## Dashboard

Access at `http://localhost:3000/dashboard` (requires `DASHBOARD_USER` and `DASHBOARD_PASS`).

Features:
- Job queue status and statistics
- Claude session replay (see every tool call)
- Analysis results with root cause and fix suggestions
- Direct links to Linear issues

## Webhook Payload

Lineu accepts any JSON payload. It extracts error information automatically from common formats (New Relic, Sentry) or processes raw JSON.

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "error": "TypeError: Cannot read property of undefined",
    "service": "api",
    "stacktrace": "at UserController.get (/app/controllers/user.js:42)"
  }'
```

## Architecture

```
src/
├── index.ts      # CLI entry point
├── server.ts     # Fastify endpoints
├── worker.ts     # Background job processor
├── db.ts         # SQLite (jobs + deduplication)
├── services/
│   ├── claude.ts # Claude CLI integration
│   └── linear.ts # Linear SDK
└── prompts/      # Analysis prompt templates
```

## Docker

```bash
docker build -t lineu .
docker run -p 3000:3000 \
  -e LINEAR_API_KEY=lin_api_xxx \
  -e ANTHROPIC_API_KEY=sk-xxx \
  -v /path/to/repo:/repo \
  lineu serve --repo /repo
```

## License

MIT
