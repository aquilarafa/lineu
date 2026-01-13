#!/usr/bin/env node
import fs from 'fs';
import { program } from 'commander';
import { loadConfig, loadConfigFile, getDefaultDatabasePath } from './lib/config.js';
import { createDatabase } from './db.js';
import { ClaudeService } from './services/claude.js';
import { LinearService } from './services/linear.js';
import { startWorker } from './worker.js';
import { createServer } from './server.js';
import { generateFingerprint } from './lib/fingerprint.js';
import { cloneRepository } from './lib/git.js';

program
  .name('lineu')
  .description('Error webhook → Claude Code → Linear')
  .version('1.0.0');

program
  .command('serve')
  .description('Start webhook server')
  .option('-r, --repo <path>', 'Path to local repository')
  .option('-u, --repo-url <url>', 'Git URL to clone (e.g., git@github.com:org/repo.git)')
  .option('-p, --port <number>', 'Port', '3000')
  .option('-c, --config <path>', 'Path to config file (default: ~/.lineu/config.yml)')
  .option('--dry-run', 'Process jobs but do not create Linear issues')
  .action(async (opts) => {
    // Resolve repository path
    let repoPath = opts.repo;

    if (opts.repoUrl) {
      repoPath = await cloneRepository(opts.repoUrl);
    }

    if (!repoPath) {
      console.error('Error: Either --repo or --repo-url is required');
      process.exit(1);
    }

    const config = loadConfig({
      repo: { path: repoPath },
      server: { port: parseInt(opts.port) },
    });

    const db = createDatabase(config.database.path);
    const claude = new ClaudeService(config.claude);
    const linear = new LinearService(config.linear);

    // Load config file and set allowed teams and prefix
    const configResult = loadConfigFile(opts.config, !!opts.config);
    if (configResult) {
      linear.setAllowedTeams(configResult.teams);
      linear.setPrefix(configResult.prefix || null);
    }

    // Fetch teams at startup
    const teamResult = await linear.fetchTeams();
    if (!teamResult.success || teamResult.count === 0) {
      console.error('Error: Failed to load Linear teams. Cannot route issues.');
      process.exit(1);
    }

    // Start background worker
    const worker = startWorker(config, db, claude, linear, { dryRun: opts.dryRun });

    // Start HTTP server
    const server = await createServer(config, db, linear);
    await server.listen({ port: config.server.port, host: '0.0.0.0' });

    const dryRunMsg = opts.dryRun ? '\n  Mode:    DRY-RUN (no Linear issues created)' : '';
    console.log(`
Lineu running!
  Repo:      ${config.repo.path}
  Webhook:   http://localhost:${config.server.port}/webhook
  Health:    http://localhost:${config.server.port}/health
  Stats:     http://localhost:${config.server.port}/stats
  Dashboard: http://localhost:${config.server.port}/dashboard${dryRunMsg}
    `);

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutting down...');
      worker.stop();
      await server.close();
      db.close();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  });

program
  .command('test')
  .description('Test analysis with a sample error')
  .option('-r, --repo <path>', 'Path to local repository')
  .option('-u, --repo-url <url>', 'Git URL to clone')
  .option('-m, --message <msg>', 'Error message', 'TypeError: Cannot read property of undefined')
  .option('-f, --file <path>', 'JSON file with payload')
  .option('-c, --config <path>', 'Path to config file (default: ~/.lineu/config.yml)')
  .option('--dry-run', "Don't create Linear card")
  .action(async (opts) => {
    let repoPath = opts.repo;

    if (opts.repoUrl) {
      repoPath = await cloneRepository(opts.repoUrl);
    }

    if (!repoPath) {
      console.error('Error: Either --repo or --repo-url is required');
      process.exit(1);
    }

    const config = loadConfig({ repo: { path: repoPath } });

    // Payload from file or generated from message
    const payload: Record<string, unknown> = opts.file
      ? JSON.parse(fs.readFileSync(opts.file, 'utf-8'))
      : { message: opts.message, timestamp: new Date().toISOString() };

    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('\nFingerprint:', generateFingerprint(payload));

    // Fetch teams for routing
    const linear = new LinearService(config.linear);

    // Load config file and set allowed teams and prefix
    const configResult = loadConfigFile(opts.config, !!opts.config);
    if (configResult) {
      linear.setAllowedTeams(configResult.teams);
      linear.setPrefix(configResult.prefix || null);
    }

    const teamResult = await linear.fetchTeams();
    if (!teamResult.success || teamResult.count === 0) {
      console.error('Error: Failed to load Linear teams');
      process.exit(1);
    }

    const teamList = linear.getTeamListForPrompt();
    console.log('\nRunning Claude Code analysis...\n');

    const claude = new ClaudeService(config.claude);
    const analysis = await claude.analyze(config.repo.path, payload, undefined, teamList);

    console.log('Analysis:', JSON.stringify(analysis, null, 2));

    if (!opts.dryRun) {
      const team = linear.resolveTeamId(analysis.suggested_team);
      if (!team) {
        console.error('Error: No teams available in Linear');
        process.exit(1);
      }
      console.log(`\nCreating Linear issue in team ${team.key}...`);
      const issue = await linear.createIssue(team.id, payload, analysis, generateFingerprint(payload));
      console.log(`Created: ${issue.identifier} - ${issue.url}`);
    } else {
      console.log('\n(Dry run - Linear issue not created)');
    }
  });

program
  .command('stats')
  .description('Show statistics')
  .option('-d, --db <path>', 'Database path')
  .action((opts) => {
    const dbPath = opts.db || getDefaultDatabasePath();
    const db = createDatabase(dbPath);
    const stats = db.getStats();
    console.log('Job Statistics:');
    console.log(`  Total:     ${stats.total}`);
    console.log(`  Pending:   ${stats.pending}`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Failed:    ${stats.failed}`);
    console.log(`  Duplicate: ${stats.duplicate}`);
    db.close();
  });

program.parse();
