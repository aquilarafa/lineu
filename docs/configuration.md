# Configuration

## Config File

Lineu uses a YAML file to configure which Linear teams can receive issues.

**Default location:** `~/.lineu/config.yml`

```yaml
# List of allowed Linear team keys.
# If omitted, Claude uses all active teams from the API.
teams:
  - ENG
  - INFRA
  - PRODUCT
```

## Behavior

| Scenario | Result |
|----------|--------|
| File doesn't exist (default path) | Uses all teams, no error |
| File doesn't exist (via `--config`) | Error |
| Malformed file | Error with YAML parser message |
| Configured team doesn't exist in Linear | Warning in log |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINEAR_API_KEY` | Yes | Linear API key for creating issues |
| `GITHUB_TOKEN` | No | GitHub token for cloning private repositories |
| `DASHBOARD_USER` | No | Username for dashboard authentication |
| `DASHBOARD_PASS` | No | Password for dashboard authentication |

## Example `.env`

```bash
LINEAR_API_KEY=lin_api_xxxxxxxxxxxx
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
DASHBOARD_USER=admin
DASHBOARD_PASS=secure-password
```
