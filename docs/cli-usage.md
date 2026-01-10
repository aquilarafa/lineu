# Comandos CLI

## `lineu serve`

Inicia o servidor de webhooks.

```bash
lineu serve --repo /path/to/repo
lineu serve --repo-url git@github.com:org/repo.git
lineu serve --repo /path/to/repo --port 3001
```

### Opções

| Flag | Descrição | Default |
|------|-----------|---------|
| `-r, --repo <path>` | Caminho do repositório local | - |
| `-u, --repo-url <url>` | URL Git para clonar | - |
| `-p, --port <number>` | Porta do servidor | 3000 |
| `-c, --config <path>` | Arquivo de configuração | `~/.lineu/config.yml` |

---

## `lineu test`

Testa análise de erro localmente, sem iniciar o servidor.

```bash
lineu test --repo /path/to/repo --message "TypeError: undefined"
lineu test --repo /path/to/repo --file ./payload.json
lineu test --repo /path/to/repo --file ./payload.json --dry-run
```

### Opções

| Flag | Descrição | Default |
|------|-----------|---------|
| `-r, --repo <path>` | Caminho do repositório local | - |
| `-u, --repo-url <url>` | URL Git para clonar | - |
| `-m, --message <msg>` | Mensagem de erro simples | `TypeError: Cannot read property of undefined` |
| `-f, --file <path>` | Arquivo JSON com payload completo | - |
| `-c, --config <path>` | Arquivo de configuração | `~/.lineu/config.yml` |
| `--dry-run` | Não cria issue no Linear | false |

---

## `lineu stats`

Exibe estatísticas de jobs processados.

```bash
lineu stats
lineu stats --db ./custom-path.db
```

### Opções

| Flag | Descrição | Default |
|------|-----------|---------|
| `-d, --db <path>` | Caminho do banco de dados | `~/.lineu/lineu.db` |
