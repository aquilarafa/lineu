# Lineu - Sistema de Triagem de Erros

Automatiza triagem de erros: webhook → análise com Claude CLI → issue no Linear.

## Stack

TypeScript, Fastify, better-sqlite3, @linear/sdk, Claude CLI

## Estrutura

```
src/
├── index.ts      # CLI entry point (serve, test, stats)
├── server.ts     # Endpoints Fastify
├── worker.ts     # Job processor (poll 10s)
├── db.ts         # SQLite (~/.lineu/lineu.db)
├── types.ts      # Definições de tipos
├── lib/          # Utilitários (config, fingerprint, git)
├── services/     # Integrações (claude, linear, newrelic)
└── prompts/      # Templates de prompt
```

## Desenvolvimento

```bash
npm install       # Instalar dependências
npm run build     # Compilar TypeScript
npm run dev       # Modo desenvolvimento
```

## Variáveis de Ambiente

- `LINEAR_API_KEY` - Obrigatório para criar issues
- `DASHBOARD_USER` / `DASHBOARD_PASS` - Proteção do /dashboard

## Comandos Principais

```bash
lineu serve --repo /path/to/repo    # Inicia servidor webhook
lineu test --repo /path --dry-run   # Testa análise localmente
lineu stats                         # Ver estatísticas de jobs
```

## Documentação

- [docs/architecture.md](docs/architecture.md) - Diagrama e fluxo de processamento
- [docs/cli-usage.md](docs/cli-usage.md) - Detalhes de todos os comandos
- [docs/configuration.md](docs/configuration.md) - Configuração e variáveis de ambiente
