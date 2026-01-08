# feat: Web Dashboard para Observabilidade do Lineu

## Overview

Dashboard web mínimo para visualizar o status do sistema Lineu. Permitirá que operadores vejam rapidamente se o sistema está funcionando e investiguem quando não estiver.

**Objetivo**: Substituir queries manuais no SQLite por uma página web simples.

```
+----------------------------------------------------------+
| LINEU DASHBOARD                         [Auto-refresh 30s]|
+----------------------------------------------------------+
| [Pending: 5]  [Processing: 1]  [Completed: 142]  [Failed: 3]|
+----------------------------------------------------------+
|  JOBS (últimos 100)                                       |
|  | ID | Status | Fingerprint | Duration | Linear | Time  |
|  | 26 | failed | a1b2c3d4    | 45s      | -      | 2m ago|
|  | 25 | done   | e5f6g7h8    | 38s      | ENG-45 | 5m ago|
+----------------------------------------------------------+
|  JOBS/HORA (24h)                                          |
|  [Simple bar chart showing job volume over time]          |
+----------------------------------------------------------+
```

## Problem Statement

O Lineu processa erros em background sem visibilidade:
- Operadores precisam fazer queries SQL para ver o que está acontecendo
- Não há forma rápida de saber se o sistema está saudável
- Jobs falhos são difíceis de investigar

## Solution

Uma única página HTML servida em `/dashboard` que mostra:
1. Contadores de jobs por status
2. Tabela com os últimos 100 jobs
3. Gráfico simples de jobs/hora nas últimas 24h
4. Auto-refresh a cada 30 segundos

## Technical Approach

### Stack Mínimo

| Camada | Tecnologia | Justificativa |
|--------|------------|---------------|
| Estático | @fastify/static | Servir HTML/CSS/JS |
| Autenticação | HTTP Basic Auth | Proteger dados internos |
| Charts | Chart.js (CDN) | Um gráfico, sem build |
| Interatividade | Vanilla JS | Refresh automático, zero frameworks |

### Endpoints

```
GET /dashboard              → HTML (página principal)
GET /api/dashboard/stats    → JSON { pending, processing, completed, failed, duplicate }
GET /api/dashboard/jobs     → JSON [ últimos 100 jobs ]
GET /api/dashboard/timeline → JSON [ jobs por hora, últimas 24h ]
```

Todos os endpoints requerem autenticação via HTTP Basic Auth.

### Estrutura de Arquivos

```
src/
├── dashboard/
│   └── routes.ts          # Endpoints do dashboard
└── public/
    └── index.html         # Página única (HTML + CSS + JS inline)
```

### Dependências

```bash
npm install @fastify/static @fastify/basic-auth
```

### Autenticação

Credenciais via variáveis de ambiente:

```bash
DASHBOARD_USER=admin
DASHBOARD_PASS=<senha-segura>
```

```typescript
// src/dashboard/routes.ts
import fastifyBasicAuth from '@fastify/basic-auth';

await app.register(fastifyBasicAuth, {
  validate: async (username, password) => {
    const validUser = process.env.DASHBOARD_USER;
    const validPass = process.env.DASHBOARD_PASS;
    if (username !== validUser || password !== validPass) {
      return new Error('Invalid credentials');
    }
  },
  authenticate: true
});

app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/dashboard') || request.url.startsWith('/api/dashboard')) {
    await app.basicAuth(request, reply);
  }
});
```

### API: Stats

```typescript
// GET /api/dashboard/stats
app.get('/api/dashboard/stats', async () => {
  return db.getStats(); // já existe
});
```

### API: Jobs

```typescript
// GET /api/dashboard/jobs
const getRecentJobsStmt = db.prepare(`
  SELECT
    id,
    fingerprint,
    status,
    error,
    linear_identifier,
    created_at,
    processed_at,
    CASE
      WHEN processed_at IS NOT NULL
      THEN (julianday(processed_at) - julianday(created_at)) * 86400
      ELSE NULL
    END as duration_seconds
  FROM jobs
  ORDER BY created_at DESC
  LIMIT 100
`);

app.get('/api/dashboard/jobs', async () => {
  return getRecentJobsStmt.all();
});
```

### API: Timeline

```typescript
// GET /api/dashboard/timeline
const getTimelineStmt = db.prepare(`
  SELECT
    strftime('%Y-%m-%d %H:00', created_at) as hour,
    COUNT(*) as total,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
  FROM jobs
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY hour
  ORDER BY hour ASC
`);

app.get('/api/dashboard/timeline', async () => {
  return getTimelineStmt.all();
});
```

### Frontend: index.html

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <title>Lineu Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    :root {
      --pending: #f59e0b;
      --processing: #3b82f6;
      --completed: #10b981;
      --failed: #ef4444;
      --duplicate: #6b7280;
    }
    body { font-family: system-ui; max-width: 1200px; margin: 0 auto; padding: 1rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .stat { padding: 1rem; border-radius: 8px; color: white; flex: 1; text-align: center; }
    .stat-pending { background: var(--pending); }
    .stat-processing { background: var(--processing); }
    .stat-completed { background: var(--completed); }
    .stat-failed { background: var(--failed); }
    .stat h2 { margin: 0; font-size: 2rem; }
    .stat span { font-size: 0.875rem; opacity: 0.9; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
    .status { padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; color: white; }
    .status-pending { background: var(--pending); }
    .status-processing { background: var(--processing); }
    .status-completed { background: var(--completed); }
    .status-failed { background: var(--failed); }
    .status-duplicate { background: var(--duplicate); }
    a { color: #3b82f6; }
    .chart-container { height: 200px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .refresh-info { color: #6b7280; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Lineu Dashboard</h1>
    <span class="refresh-info">Auto-refresh: 30s</span>
  </div>

  <div class="stats" id="stats">
    <div class="stat stat-pending"><h2>-</h2><span>Pending</span></div>
    <div class="stat stat-processing"><h2>-</h2><span>Processing</span></div>
    <div class="stat stat-completed"><h2>-</h2><span>Completed</span></div>
    <div class="stat stat-failed"><h2>-</h2><span>Failed</span></div>
  </div>

  <h2>Recent Jobs</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Status</th>
        <th>Fingerprint</th>
        <th>Duration</th>
        <th>Linear</th>
        <th>Created</th>
      </tr>
    </thead>
    <tbody id="jobs"></tbody>
  </table>

  <h2>Jobs/Hour (24h)</h2>
  <div class="chart-container">
    <canvas id="chart"></canvas>
  </div>

  <script>
    let chart;

    async function loadDashboard() {
      const [statsRes, jobsRes, timelineRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/dashboard/jobs'),
        fetch('/api/dashboard/timeline')
      ]);

      const stats = await statsRes.json();
      const jobs = await jobsRes.json();
      const timeline = await timelineRes.json();

      // Update stats
      document.querySelector('.stat-pending h2').textContent = stats.pending;
      document.querySelector('.stat-completed h2').textContent = stats.completed;
      document.querySelector('.stat-failed h2').textContent = stats.failed;

      // Update jobs table
      document.getElementById('jobs').innerHTML = jobs.map(job => `
        <tr>
          <td>${job.id}</td>
          <td><span class="status status-${job.status}">${job.status}</span></td>
          <td>${job.fingerprint.slice(0, 8)}</td>
          <td>${job.duration_seconds ? Math.round(job.duration_seconds) + 's' : '-'}</td>
          <td>${job.linear_identifier
            ? `<a href="https://linear.app/issue/${job.linear_identifier}" target="_blank">${job.linear_identifier}</a>`
            : '-'}</td>
          <td>${timeAgo(job.created_at)}</td>
        </tr>
      `).join('');

      // Update chart
      if (chart) chart.destroy();
      chart = new Chart(document.getElementById('chart'), {
        type: 'bar',
        data: {
          labels: timeline.map(t => t.hour.split(' ')[1]),
          datasets: [
            { label: 'Completed', data: timeline.map(t => t.completed), backgroundColor: '#10b981' },
            { label: 'Failed', data: timeline.map(t => t.failed), backgroundColor: '#ef4444' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
        }
      });
    }

    function timeAgo(dateStr) {
      const seconds = Math.floor((new Date() - new Date(dateStr + 'Z')) / 1000);
      if (seconds < 60) return seconds + 's ago';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    }

    loadDashboard();
  </script>
</body>
</html>
```

## Acceptance Criteria

- [ ] Dashboard acessível em `/dashboard` com autenticação
- [ ] Exibe contagem de jobs por status (pending, processing, completed, failed)
- [ ] Lista últimos 100 jobs com status, fingerprint, duração, link Linear
- [ ] Gráfico de barras mostrando jobs/hora nas últimas 24h
- [ ] Auto-refresh a cada 30 segundos
- [ ] Prepared statements em todas as queries (segurança)

## NOT in MVP (Backlog)

Estas features foram consideradas mas removidas do MVP:
- SSE para updates em tempo real (polling é suficiente)
- Filtros por status (use Ctrl+F no browser)
- Paginação (100 jobs é suficiente para scroll)
- Expand/collapse de jobs (link para `/jobs/:id` existente)
- Worker heartbeat (inferir do status dos jobs)
- Timing breakdown (git/claude/linear)
- Mobile responsiveness
- Dark mode
- Export CSV/JSON
- Alertas via Slack

## Implementation Checklist

- [ ] `npm install @fastify/static @fastify/basic-auth`
- [ ] Criar `src/dashboard/routes.ts` com 4 endpoints
- [ ] Criar `src/public/index.html`
- [ ] Adicionar variáveis `DASHBOARD_USER` e `DASHBOARD_PASS` ao `.env.example`
- [ ] Registrar rotas do dashboard em `src/server.ts`
- [ ] Testar autenticação
- [ ] Testar em Chrome e Firefox

## Timeline

**Estimativa: 2-3 dias**

| Dia | Tarefa |
|-----|--------|
| 1 | Setup rotas, autenticação, endpoints JSON |
| 2 | index.html com stats, tabela, gráfico |
| 3 | Testes, ajustes, deploy |

## Schema Changes

**Nenhum.** Todas as informações necessárias já existem na tabela `jobs`.

- Duration: calculado como `processed_at - created_at`
- Stats: já existe via `db.getStats()`

## Security Considerations

1. **Autenticação obrigatória**: HTTP Basic Auth em todos os endpoints `/dashboard*`
2. **Prepared statements**: Todas as queries SQL usam prepared statements
3. **Sanitização de output**: Fingerprint truncado, sem dados sensíveis expostos
4. **HTTPS recomendado**: Usar reverse proxy (nginx/caddy) com TLS em produção

## References

- `src/server.ts:172-193` - Endpoints existentes
- `src/db.ts:110-118` - Função getStats()
- [Fastify Static](https://github.com/fastify/fastify-static)
- [Fastify Basic Auth](https://github.com/fastify/fastify-basic-auth)
- [Chart.js](https://www.chartjs.org/)

---

*Plano simplificado em 2026-01-08 após revisão de DHH, Kieran e Simplicity.*
