# Lineu - Sistema de Triagem de Erros

Sistema automatizado de triagem de erros que conecta webhooks, análise com Claude Code e criação de issues no Linear.

## Arquitetura

```
+------------------+
|  Fonte de Erros  |
|  (New Relic,     |
|   Sentry, etc)   |
+--------+---------+
         |
   POST qualquer JSON
         |
         v
+------------------+     +------------------+
|  Lineu Server    |---->|    SQLite DB     |
|                  |     |  - jobs (fila)   |
|  POST /webhook   |     |  - fingerprints  |
|  GET /health     |     +--------+---------+
|  GET /stats      |              |
+------------------+              |
                                  | Worker lê jobs
      +---------------------------+ pendentes (10s)
      |
      v
+------------------+     +------------------+
|  Background      |     |  Repositório     |
|  Worker          |---->|  Configurado     |
|                  |     |                  |
|  - Processa jobs |     |  git pull (5min) |
+--------+---------+     +------------------+
         |
         | Executa Claude Code
         v
+------------------+
|  Claude Code CLI |
|                  |
|  $ claude -p     |
|    --output json |
+--------+---------+
         |
         v
+------------------+
|  Linear API      |
|                  |
|  Cria issue com: |
|  - Análise       |
|  - Arquivos      |
|  - Sugestões     |
+------------------+
```

**Fluxo:**
1. Webhook salva job no SQLite → retorna 202 imediatamente
2. Worker processa jobs pendentes a cada 10s
3. Git pull roda a cada 5 min (independente dos jobs)
4. Se Claude/Linear falhar, job fica `failed` (não cria issue lixo)

## O que faz

1. **Recebe webhooks de erros** de sistemas de monitoramento (especialmente New Relic)
2. **Analisa erros com Claude Code** CLI dentro do contexto do repositório
3. **Cria issues no Linear** automaticamente roteadas para o time apropriado
4. **Deduplica erros** usando fingerprinting para evitar duplicatas

## Stack

- **TypeScript** com strict mode
- **Fastify** para servidor HTTP
- **better-sqlite3** para fila de jobs (armazenado em `~/.lineu/lineu.db`)
- **@linear/sdk** para integração com Linear
- **Claude CLI** para análise de erros

## Estrutura do Projeto

```
src/
├── index.ts          # Entry point CLI (serve, test, stats)
├── server.ts         # Endpoints webhook Fastify
├── worker.ts         # Processador de jobs em background
├── db.ts             # Camada de banco de dados SQLite
├── types.ts          # Definições de tipos
├── lib/              # Utilitários (config, fingerprint, git)
└── services/         # Integrações externas (claude, linear, newrelic)
```

## Comandos

### `lineu serve` - Inicia servidor de webhooks

```bash
lineu serve --repo /path/to/repo           # Repo local
lineu serve --repo-url git@github.com:org/repo.git  # Clona automaticamente
lineu serve --repo /path/to/repo --port 3001
```

Opções:
- `-r, --repo <path>` - Caminho do repositório local
- `-u, --repo-url <url>` - URL Git para clonar (ex: `git@github.com:org/repo.git`)
- `-p, --port <number>` - Porta (default: 3000)
- `-c, --config <path>` - Arquivo de configuração (default: `~/.lineu/config.yml`)

Endpoints disponíveis:
- `POST /webhook` - Recebe erros (qualquer JSON)
- `GET /health` - Health check
- `GET /stats` - Estatísticas
- `GET /dashboard` - Dashboard web (requer DASHBOARD_USER/DASHBOARD_PASS)

### `lineu test` - Testa análise sem servidor

```bash
lineu test --repo /path/to/repo --message "TypeError: undefined"
lineu test --repo /path/to/repo --file ./payload.json
lineu test --repo /path/to/repo --file ./payload.json --dry-run
```

Opções:
- `-r, --repo <path>` - Caminho do repositório local
- `-u, --repo-url <url>` - URL Git para clonar
- `-m, --message <msg>` - Mensagem de erro (default: "TypeError: Cannot read property of undefined")
- `-f, --file <path>` - Arquivo JSON com payload
- `-c, --config <path>` - Arquivo de configuração (default: `~/.lineu/config.yml`)
- `--dry-run` - Não cria issue no Linear

### `lineu stats` - Estatísticas de jobs

```bash
lineu stats
lineu stats --db ./custom-path.db
```

Opções:
- `-d, --db <path>` - Caminho do banco de dados (default: `~/.lineu/lineu.db`)

## Arquivo de Configuração

O Lineu suporta um arquivo de configuração YAML para filtrar quais times do Linear podem ser sugeridos pelo Claude.

**Localização padrão:** `~/.lineu/config.yml`

```yaml
# Lista de team keys do Linear permitidos para sugestão.
# Se omitido, Claude usa todos os times ativos da API.
teams:
  - ENG
  - INFRA
  - PRODUCT
```

**Comportamento:**
- Se o arquivo não existir no path padrão: usa todos os times (sem erro)
- Se o arquivo não existir quando especificado via `--config`: erro
- Se o arquivo for malformado: erro com mensagem do parser YAML
- Times configurados mas não encontrados no Linear: warning no log
