import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { discoverRepos } from './discovery.js';
import { pollGitHub } from './pollers/github.js';
import { pollRender } from './pollers/render.js';
import { pollStripe } from './pollers/stripe.js';
import { pollSupabase } from './pollers/supabase.js';
import { pollVercel } from './pollers/vercel.js';
import { pollCloudflare } from './pollers/cloudflare.js';
import { pollAgentHealth } from './pollers/agents.js';
import { pollDomains } from './pollers/domains.js';
import { pollSelfHealth } from './pollers/self-health.js';
import { healthRoutes } from './health-api.js';
import { log } from './lib/logger.js';

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'cto-agent-monitor', uptime: process.uptime() }));

// Health API routes (consumed by Cockpit dashboard)
app.route('/api', healthRoutes);

// State
let repos: string[] = [];
const POLL_INTERVALS = {
  discovery: 60 * 60 * 1000,  // 1 hour — refresh repo list
  render: 2 * 60 * 1000,       // 2 min
  github: 5 * 60 * 1000,       // 5 min
  stripe: 5 * 60 * 1000,       // 5 min
  supabase: 5 * 60 * 1000,     // 5 min
  vercel: 5 * 60 * 1000,       // 5 min
  cloudflare: 5 * 60 * 1000,   // 5 min
  agents: 10 * 60 * 1000,      // 10 min
  selfHealth: 15 * 60 * 1000,   // 15 min — CTO agent self-monitoring
  domains: 24 * 60 * 60 * 1000, // daily
};

async function startPollers() {
  log('info', 'Starting CTO Agent Monitor');

  // Initial repo discovery
  repos = await discoverRepos();
  log('info', `Discovered ${repos.length} repos`);

  // GitHub CI poller
  setInterval(async () => {
    try { await pollGitHub(repos); }
    catch (e) { log('error', `GitHub poller failed: ${e}`); }
  }, POLL_INTERVALS.github);

  // Render deploy poller
  setInterval(async () => {
    try { await pollRender(); }
    catch (e) { log('error', `Render poller failed: ${e}`); }
  }, POLL_INTERVALS.render);

  // Stripe webhook poller
  setInterval(async () => {
    try { await pollStripe(); }
    catch (e) { log('error', `Stripe poller failed: ${e}`); }
  }, POLL_INTERVALS.stripe);

  // Supabase health poller
  setInterval(async () => {
    try { await pollSupabase(); }
    catch (e) { log('error', `Supabase poller failed: ${e}`); }
  }, POLL_INTERVALS.supabase);

  // Vercel deploy poller
  setInterval(async () => {
    try { await pollVercel(); }
    catch (e) { log('error', `Vercel poller failed: ${e}`); }
  }, POLL_INTERVALS.vercel);

  // Cloudflare Workers poller
  setInterval(async () => {
    try { await pollCloudflare(); }
    catch (e) { log('error', `Cloudflare poller failed: ${e}`); }
  }, POLL_INTERVALS.cloudflare);

  // Agent health poller
  setInterval(async () => {
    try { await pollAgentHealth(); }
    catch (e) { log('error', `Agent health poller failed: ${e}`); }
  }, POLL_INTERVALS.agents);

  // Domain/SSL expiry poller
  setInterval(async () => {
    try { await pollDomains(); }
    catch (e) { log('error', `Domain poller failed: ${e}`); }
  }, POLL_INTERVALS.domains);

  // Self-health poller — the CTO agent monitors itself
  setInterval(async () => {
    try { await pollSelfHealth(repos); }
    catch (e) { log('error', `Self-health poller failed: ${e}`); }
  }, POLL_INTERVALS.selfHealth);

  // Repo discovery refresh
  setInterval(async () => {
    try {
      repos = await discoverRepos();
      log('info', `Refreshed repo list: ${repos.length} repos`);
    } catch (e) { log('error', `Discovery failed: ${e}`); }
  }, POLL_INTERVALS.discovery);

  // Run all pollers once on startup
  await Promise.allSettled([
    pollGitHub(repos),
    pollRender(),
    pollStripe(),
    pollSupabase(),
    pollVercel(),
    pollCloudflare(),
    pollAgentHealth(),
    pollDomains(),
    pollSelfHealth(repos),
  ]);

  log('info', 'All pollers initialized');
}

const port = parseInt(process.env.PORT || '3002', 10);
serve({ fetch: app.fetch, port }, () => {
  log('info', `CTO Agent Monitor running on port ${port}`);
  startPollers();
});

export { app };
