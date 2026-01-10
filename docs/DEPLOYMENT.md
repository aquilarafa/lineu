# Deploy com Docker

## Build

```bash
docker build -t lineu .
```

## Run

### Opção 1: Repositório local

```bash
docker run -d \
  --name lineu \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e LINEAR_API_KEY=lin_api_xxx \
  -e DASHBOARD_USER=admin \
  -e DASHBOARD_PASS=senha-segura \
  -v lineu-data:/home/lineu/.lineu \
  -v /caminho/do/repo:/repo \
  lineu serve --repo /repo
```

### Opção 2: Repositório remoto

```bash
docker run -d \
  --name lineu \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e LINEAR_API_KEY=lin_api_xxx \
  -e DASHBOARD_USER=admin \
  -e DASHBOARD_PASS=senha-segura \
  -v lineu-data:/home/lineu/.lineu \
  lineu serve --repo-url https://github.com/org/repo.git
```

Para repositórios privados via SSH:

```bash
docker run -d \
  --name lineu \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e LINEAR_API_KEY=lin_api_xxx \
  -v lineu-data:/home/lineu/.lineu \
  -v ~/.ssh:/home/lineu/.ssh:ro \
  lineu serve --repo-url git@github.com:org/repo.git
```

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `ANTHROPIC_API_KEY` | Sim* | API key da Anthropic para Claude Code |
| `LINEAR_API_KEY` | Sim | API key do Linear |
| `DASHBOARD_USER` | Não | Usuário para dashboard |
| `DASHBOARD_PASS` | Não | Senha para dashboard |

*`ANTHROPIC_API_KEY` é obrigatória para deploy em servidor (headless). Localmente, você pode usar `claude /login` para autenticar via browser. Obtenha sua API key em https://console.anthropic.com/

## Volumes

| Volume | Obrigatório | Descrição |
|--------|-------------|-----------|
| `/home/lineu/.lineu` | Sim | Banco SQLite e logs |
| `/repo` | Não* | Repositório local para análise |
| `/home/lineu/.ssh` | Não* | Chaves SSH para repos privados |

*Use `/repo` com `--repo` ou `.ssh` com `--repo-url` para repos privados.

## Verificar

```bash
# Health check
curl http://localhost:3000/health

# Estatísticas
curl http://localhost:3000/stats

# Testar webhook
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"error": "teste"}'
```

## Logs

```bash
docker logs -f lineu
```

## Backup

```bash
docker exec lineu sqlite3 /home/lineu/.lineu/lineu.db \
  ".backup /home/lineu/.lineu/backup.db"

docker cp lineu:/home/lineu/.lineu/backup.db ./backup.db
```

## Troubleshooting

```bash
# Jobs pendentes
docker exec lineu sqlite3 /home/lineu/.lineu/lineu.db \
  "SELECT id, status FROM jobs ORDER BY created_at DESC LIMIT 5;"

# Reset job travado
docker exec lineu sqlite3 /home/lineu/.lineu/lineu.db \
  "UPDATE jobs SET status='pending' WHERE status='processing';"

# Verificar Claude CLI
docker exec lineu claude --version
```

## Reverse Proxy

Configure seu proxy preferido (nginx, Caddy, Traefik, etc.) para:
- Apontar para `localhost:3000`
- Terminar SSL
- Rate limit em `/webhook` (recomendado)
