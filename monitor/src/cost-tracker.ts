import { log } from './lib/logger.js';
import { optionalEnv } from './lib/env.js';
import { sendAlert } from './slack.js';

// Estimated cost per Claude Code run (Opus-class model, ~25 turns avg)
const ESTIMATED_COST_PER_RUN = 0.50; // $0.50 average

let dailySpend = 0;
let dailyRunCount = 0;
let lastResetDate = new Date().toISOString().split('T')[0];

function resetIfNewDay(): void {
  const today = new Date().toISOString().split('T')[0];
  if (today !== lastResetDate) {
    log('info', `Daily cost reset: yesterday=$${dailySpend.toFixed(2)} runs=${dailyRunCount}`);
    dailySpend = 0;
    dailyRunCount = 0;
    lastResetDate = today;
  }
}

/**
 * Record a Claude Code run cost estimate.
 * Returns false if budget exceeded (dispatch should be blocked).
 */
export function recordCost(): boolean {
  resetIfNewDay();

  const budgetStr = optionalEnv('CTO_AGENT_DAILY_BUDGET');
  const budget = budgetStr ? parseFloat(budgetStr) : 25; // $25/day default

  dailySpend += ESTIMATED_COST_PER_RUN;
  dailyRunCount++;

  log('info', `Cost tracker: run #${dailyRunCount}, daily total=$${dailySpend.toFixed(2)}/${budget}`);

  if (dailySpend > budget) {
    sendAlert({
      severity: 'danger',
      title: 'CTO Agent: Daily Budget Exceeded',
      message: `Estimated spend: $${dailySpend.toFixed(2)} (budget: $${budget})\nRuns today: ${dailyRunCount}\n\nAll further dispatches blocked until tomorrow.`,
    });
    return false;
  }

  if (dailySpend > budget * 0.8) {
    log('warn', `Approaching daily budget: $${dailySpend.toFixed(2)}/$${budget}`);
  }

  return true;
}

export function isBudgetExceeded(): boolean {
  resetIfNewDay();
  const budgetStr = optionalEnv('CTO_AGENT_DAILY_BUDGET');
  const budget = budgetStr ? parseFloat(budgetStr) : 25;
  return dailySpend > budget;
}

export function getDailyCostSummary(): { spend: number; runs: number; budget: number } {
  resetIfNewDay();
  const budgetStr = optionalEnv('CTO_AGENT_DAILY_BUDGET');
  const budget = budgetStr ? parseFloat(budgetStr) : 25;
  return { spend: dailySpend, runs: dailyRunCount, budget };
}
