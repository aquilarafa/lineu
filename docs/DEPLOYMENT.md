# Deploy com Docker

## Docker Compose (recomendado)

```bash
# Copie e configure as variáveis
cp .env.example .env

# Edite .env com suas credenciais
# ANTHROPIC_API_KEY, LINEAR_API_KEY, REPO_URL, etc.

# Inicie
docker compose up -d

# Logs
docker compose logs -f

# Parar
docker compose down
```

Para usar repositório local, edite `docker-compose.yml`:
```yaml
volumes:
  - /caminho/do/repo:/repo
command: ["serve", "--repo", "/repo"]
```

## Build Manual

```bash
docker build -t lineu .
```

## Run Manual

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

### Opção 2: Repositório remoto (público)

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

### Opção 3: Repositório privado

Use `GITHUB_TOKEN` para autenticar:

```bash
docker run -d \
  --name lineu \
  -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e LINEAR_API_KEY=lin_api_xxx \
  -e GITHUB_TOKEN=ghp_xxxxxxxxxxxx \
  -e DASHBOARD_USER=admin \
  -e DASHBOARD_PASS=senha-segura \
  -v lineu-data:/home/lineu/.lineu \
  lineu serve --repo-url https://github.com/org/private-repo.git
```

Para criar o token: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token com permissão `Contents: Read-only` no repositório desejado.

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `ANTHROPIC_API_KEY` | Sim* | API key da Anthropic para Claude Code |
| `LINEAR_API_KEY` | Sim | API key do Linear |
| `GITHUB_TOKEN` | Não** | Token para clonar repositórios privados |
| `DASHBOARD_USER` | Não | Usuário para dashboard |
| `DASHBOARD_PASS` | Não | Senha para dashboard |

*`ANTHROPIC_API_KEY` é obrigatória para deploy em servidor (headless). Localmente, você pode usar `claude /login` para autenticar via browser. Obtenha sua API key em https://console.anthropic.com/

**`GITHUB_TOKEN` só é necessário para repositórios privados via `--repo-url`.

## Volumes

| Volume | Obrigatório | Descrição |
|--------|-------------|-----------|
| `/home/lineu/.lineu` | Sim | Banco SQLite e logs |
| `/repo` | Não* | Repositório local para análise |

*Use `/repo` com `--repo` para montar um repositório local.

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
