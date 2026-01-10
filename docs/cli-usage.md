# CLI Commands

## `lineu serve`

Starts the webhook server.

```bash
lineu serve --repo /path/to/repo
lineu serve --repo-url git@github.com:org/repo.git
lineu serve --repo /path/to/repo --port 3001
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-r, --repo <path>` | Local repository path | - |
| `-u, --repo-url <url>` | Git URL to clone | - |
| `-p, --port <number>` | Server port | 3000 |
| `-c, --config <path>` | Config file | `~/.lineu/config.yml` |

---

## `lineu test`

Tests error analysis locally, without starting the server.

```bash
lineu test --repo /path/to/repo --message "TypeError: undefined"
lineu test --repo /path/to/repo --file ./payload.json
lineu test --repo /path/to/repo --file ./payload.json --dry-run
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-r, --repo <path>` | Local repository path | - |
| `-u, --repo-url <url>` | Git URL to clone | - |
| `-m, --message <msg>` | Simple error message | `TypeError: Cannot read property of undefined` |
| `-f, --file <path>` | JSON file with full payload | - |
| `-c, --config <path>` | Config file | `~/.lineu/config.yml` |
| `--dry-run` | Don't create Linear issue | false |

---

## `lineu stats`

Shows processed job statistics.

```bash
lineu stats
lineu stats --db ./custom-path.db
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-d, --db <path>` | Database path | `~/.lineu/lineu.db` |
