import type { PatternResult } from './types.js';

/**
 * Detects missing agent index.js files.
 * CI output format: "::error::Missing agents: foo bar baz"
 */

const MISSING_AGENTS_REGEX = /::error::Missing agents: (.+)/;

export function match(logText: string, _annotations: string[]): PatternResult | null {
  const m = logText.match(MISSING_AGENTS_REGEX);
  if (!m) return null;

  const agents = m[1].trim().split(/\s+/);
  if (agents.length === 0) return null;

  // Scaffold minimal agent index.js for each missing agent
  const files = agents.map(agent => ({
    path: `agents/${agent}/index.js`,
    content: [
      `'use strict';`,
      ``,
      `const logger = require('../../shared/utils/logger');`,
      ``,
      `const config = {`,
      `  id: '${agent}',`,
      `  name: '${agent.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}',`,
      `  pool: 'unassigned',`,
      `  schedule: null,`,
      `  approval: 'auto',`,
      `  description: 'TODO: Add description',`,
      `  requiredEnv: [],`,
      `  optionalEnv: [],`,
      `};`,
      ``,
      `function validateEnvironment(env) {`,
      `  const source = env || process.env;`,
      `  const missing = config.requiredEnv.filter(key => !source[key]);`,
      `  if (missing.length > 0) {`,
      `    throw new Error(\`Missing required environment variables: \${missing.join(', ')}\`);`,
      `  }`,
      `  return true;`,
      `}`,
      ``,
      `async function run(options = {}) {`,
      `  logger.info(\`[\${config.name}] Starting run\`);`,
      `  // TODO: Implement agent logic`,
      `  return { status: 'success', message: 'Stub agent — needs implementation' };`,
      `}`,
      ``,
      `module.exports = { config, validateEnvironment, run };`,
    ].join('\n'),
    action: 'create' as const,
  }));

  return {
    matched: true,
    patternName: 'missing-agent-index',
    description: `Scaffold ${agents.length} missing agent(s): ${agents.join(', ')}`,
    confidence: 0.85,
    files,
    testFiles: [],
  };
}
