import { describe, it, expect } from 'vitest';
import { match } from '../../patterns/missing-agent-index.js';

const SAMPLE_LOG = `
Validate Agent Structure	Verify all agents have index.js	::error::Missing agents: new-agent experimental-agent
Validate Agent Structure	Verify all agents have index.js	##[error]Process completed with exit code 1.
`;

describe('missing-agent-index pattern matcher', () => {
  it('should detect missing agents', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result).not.toBeNull();
    expect(result!.matched).toBe(true);
    expect(result!.patternName).toBe('missing-agent-index');
    expect(result!.confidence).toBe(0.85);
    expect(result!.files).toHaveLength(2);
  });

  it('should scaffold correct file paths', () => {
    const result = match(SAMPLE_LOG, []);
    const paths = result!.files.map(f => f.path);
    expect(paths).toContain('agents/new-agent/index.js');
    expect(paths).toContain('agents/experimental-agent/index.js');
  });

  it('should generate valid JS with agent boilerplate', () => {
    const result = match(SAMPLE_LOG, []);
    const content = result!.files[0].content;
    expect(content).toContain("id: 'new-agent'");
    expect(content).toContain('module.exports');
    expect(content).toContain('validateEnvironment');
    expect(content).toContain('async function run');
  });

  it('should create files (not modify)', () => {
    const result = match(SAMPLE_LOG, []);
    expect(result!.files.every(f => f.action === 'create')).toBe(true);
  });

  it('should return null for clean logs', () => {
    expect(match('✓ All 31 agents validated', [])).toBeNull();
  });
});
