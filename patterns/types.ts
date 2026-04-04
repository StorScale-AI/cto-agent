export interface FilePatch {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

export interface PatternResult {
  matched: boolean;
  patternName: string;
  description: string;
  confidence: number;
  escalateOnly?: boolean;  // If true, skip Claude Code — just alert Slack
  files: FilePatch[];
  testFiles: FilePatch[];
}

export interface PatternMatcher {
  match(logText: string, annotations: string[]): PatternResult | null;
}
