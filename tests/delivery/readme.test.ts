import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The README is the document the evaluator reads (REQ-DL-3): how to run it, what it assumes, where the model is used and why.

const readme = (): string => readFileSync('README.md', 'utf8');

/** Per-tier intent and full accuracy as printed in eval/REPORT.md, e.g. { haiku: ['88%', '72%'] }. */
function reportAccuracies(): Record<string, [string, string]> {
  const rows = readFileSync('eval/REPORT.md', 'utf8').match(/^\| (regex|haiku|sonnet) \|.*$/gm) ?? [];
  return Object.fromEntries(
    rows.map((row) => {
      const cells = row.split('|').map((cell) => cell.trim());
      return [cells[1]!, [cells[3]!, cells[4]!]];
    }),
  );
}

describe('README: running the agent (AC-2.1)', () => {
  it('states the status, the build and run commands and the environment variables', () => {
    const text = readme();
    expect(text).toMatch(/v1/);
    expect(text).toContain('docker build -t agent .');
    expect(text).toMatch(/docker run[^\n]*--env-file \.env/);
    expect(text).toMatch(/docker run[^\n]* -i\b/);
    expect(text).toMatch(/work_orders\.csv:ro/);
    expect(text).toContain('ANTHROPIC_API_KEY');
    expect(text).toContain('AGENT_NOW');
    expect(text).toMatch(/7 days/);
  });

  it('documents the CSV, the stdin lines and the stdout frames and results', () => {
    const text = readme();
    expect(text).toContain('work_order_id,work_order,address,description,reported_at,urgency');
    expect(text).toMatch(/<work_order_id>\|<role> <message/);
    expect(text).toContain('<NO RESPONSE>');
    expect(text).toContain('WOID:<work_order_id>|ROLE:<role>');
    expect(text).toContain('RESULT:scheduled');
    expect(text).toContain('SCHEDULED_FOR');
    expect(text).toContain('RESULT:requires_review');
    expect(text).toContain('REASON');
  });
});

describe('README: design, AI use, assumptions, limitations, how it was built (AC-2.2–AC-2.6)', () => {
  it('describes the design in brief with pointers to the feature specs (AC-2.2)', () => {
    const text = readme();
    for (const feature of ['001-io-protocol-startup', '002-calendar-initial-proposals', '003-interpretation-acceptance', '004-negotiation', '005-timeouts-preemption-blackouts']) {
      expect(text, feature).toContain(`specs/features/${feature}`);
    }
    expect(text).toMatch(/invariant/i);
    expect(text).toMatch(/replay/i);
  });

  it('has "Where AI is used and why" with the tier numbers of eval/REPORT.md (AC-2.3)', () => {
    const text = readme();
    expect(text).toMatch(/^## Where AI is used and why/m);
    const section = text.slice(text.indexOf('## Where AI is used and why'));
    expect(section).toMatch(/interpret/i);
    expect(section).toMatch(/question/i);
    expect(section).toMatch(/schema|validat/i);
    expect(section).toContain('eval/REPORT.md');
    const accuracies = reportAccuracies();
    for (const tier of ['haiku', 'sonnet']) {
      const [intent, full] = accuracies[tier]!;
      expect(section, `${tier} ${intent} ${full}`).toMatch(new RegExp(`\\|\\s*${tier}[^\\n]*\\|\\s*${intent}\\s*\\|\\s*${full}\\s*\\|`));
    }
  });

  it('lists the assumptions and trade-offs decided during the features (AC-2.4)', () => {
    const text = readme();
    expect(text).toMatch(/^## Assumptions and trade-offs/m);
    const section = text.slice(text.indexOf('## Assumptions and trade-offs'));
    for (const topic of [/language/i, /horizon/i, /notice|one hour after/i, /withdraw/i, /next free slot/i, /take ?over|preempt/i, /weekday/i, /reminder/i, /Critical/, /forward/i, /validator/i]) {
      expect(section, topic.source).toMatch(topic);
    }
  });

  it('names known limitations, phase 2 and the pointers (AC-2.5)', () => {
    const text = readme();
    expect(text).toMatch(/^## Known limitations/m);
    expect(text).toMatch(/phase 2/i);
    for (const pointer of ['traces/examples/', 'eval/REPORT.md', 'docs/planning/', 'docs/adr/']) expect(text, pointer).toContain(pointer);
  });

  it('explains how it was built: the pipeline, the checks, the features and the test count (AC-2.6)', () => {
    const text = readme();
    expect(text).toMatch(/^## How it was built/m);
    for (const step of ['/spec', '/plan', '/implement', '/ship', 'pnpm check']) expect(text, step).toContain(step);
    for (const feature of ['001', '002', '003', '004', '005', '006', '007']) expect(text, feature).toMatch(new RegExp(`\\b${feature}\\b`));
    expect(text).toMatch(/\b\d{3} tests\b/);
  });
});
