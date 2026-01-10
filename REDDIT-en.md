# Lineu: I automated error triage using Claude CLI

**TL;DR:** Built an open-source tool that receives error alerts (New Relic, Sentry, etc), uses Claude CLI to analyze your codebase, and automatically creates Linear issues with full diagnosis.

---

## The problem

Every dev knows this loop:
1. Error alert hits Slack/email
2. Open monitoring dashboard
3. Copy stack trace
4. Hunt through code for the issue
5. Try to understand context
6. Manually create an issue

This eats time and breaks focus.

## The solution

**Lineu** is a webhook server that:

1. **Receives** any error JSON (works with New Relic, Sentry, or custom format)
2. **Analyzes** the error using Claude CLI directly in your repository
3. **Creates** Linear issues with complete analysis: root cause, affected files, fix suggestions, and code snippets

Claude navigates your code like a senior dev would - grep, file reads, dependency analysis.

## How it works

```bash
# Start server pointing to your repo
lineu serve --repo /path/to/your/project

# Configure webhook in New Relic/Sentry
# POST http://your-server:3000/webhook
```

The dashboard shows all jobs, Claude's session working through the code, and direct links to created issues.

## Stack

- TypeScript + Fastify
- Claude CLI (uses your local API key)
- SQLite for job queue
- Linear SDK for issue creation

## Screenshots

See `reddit-screenshots/` folder:
- `dashboard.png` - Dashboard with stats and job list
- `job-session.png` - Claude session analyzing a bug
- `job-analysis.png` - Structured analysis output

## Links

- GitHub: [aquilarafa/lineu](https://github.com/aquilarafa/lineu)
- MIT License

---

Feedback welcome! Been using this in production for a few weeks and it's saved significant time on error triage.
