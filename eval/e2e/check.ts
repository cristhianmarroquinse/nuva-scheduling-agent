// Black-box checks of one end-to-end run (spec 014 AC-1.3): only stdout, stderr, the exit code and the trace are read.
// Pure, so `pnpm test` can prove each check with synthetic outputs (AC-2.1).

import { DateTime } from 'luxon';
import { inferLanguage } from '../../src/orders/language.js';
import type { Scenario } from './scenario.js';

export interface TraceLine {
  timestamp?: unknown;
  work_order_id: string | null;
  event_type: string;
  detail: Record<string, unknown>;
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  code: number | null;
  trace: TraceLine[];
  /** Trace lines that were not valid JSON (TRACE-1). */
  badTraceLines: string[];
}

type Role = 'tenant' | 'handyman';
interface Block {
  id: string;
  kind: 'frame' | 'result';
  role?: Role;
  body: string;
  result?: 'scheduled' | 'requires_review';
  extra?: string;
}

const ID = '[^|\\s](?:[^|\\n]*[^|\\s])?';
const FRAME = new RegExp(`^WOID:(${ID})\\|ROLE:(tenant|handyman)$`);
const RESULT = new RegExp(`^WOID:(${ID})\\|RESULT:(scheduled|requires_review)$`);
const WEEKDAYS = /(lunes|martes|miércoles|jueves|viernes|sábado|domingo|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^.]*\d{4}.*\d{2}:\d{2}.*\d{2}:\d{2}/;
const RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const iso = (value: unknown): DateTime => DateTime.fromISO(str(value), { setZone: true });
const overlap = (a: { s: DateTime; e: DateTime }, b: { s: DateTime; e: DateTime }): boolean => a.s < b.e && b.s < a.e;

function languageOf(text: string): 'es' | 'en' | null {
  const { evidence } = inferLanguage('', text);
  if (evidence.es === evidence.en) return null;
  return evidence.es > evidence.en ? 'es' : 'en';
}

function parseBlocks(stdout: string, failures: string[]): Block[] {
  const blocks: Block[] = [];
  for (const raw of stdout.split('\n\n').filter((block) => block.trim() !== '')) {
    const lines = raw.replace(/^\n+/, '').split('\n');
    const head = lines[0] ?? '';
    const frame = FRAME.exec(head);
    const result = RESULT.exec(head);
    if (frame && lines.length === 2 && (lines[1] ?? '').trim() !== '') blocks.push({ id: frame[1]!, kind: 'frame', role: frame[2] as Role, body: lines[1]! });
    else if (result && lines.length === 2 && /^(SCHEDULED_FOR|REASON):.+/.test(lines[1] ?? '')) blocks.push({ id: result[1]!, kind: 'result', result: result[2] as Block['result'] & string, body: '', extra: lines[1]! });
    else failures.push(`OUT-2 malformed block: ${JSON.stringify(raw.slice(0, 160))}`);
  }
  return blocks;
}

/** Every failure of the run against the invariants and the scenario's expectations; empty when it passes. */
export function checkRun(scenario: Scenario, run: RunOutput): string[] {
  const failures: string[] = [];
  if (run.stderr !== '') failures.push(`OUT-1 stderr not empty: ${run.stderr.slice(0, 200)}`);
  if (run.code !== 0) failures.push(`RUN-1 exit code ${String(run.code)}`);
  if (run.stdout !== '' && !run.stdout.endsWith('\n\n')) failures.push('OUT-2 stdout does not end with a blank line');
  for (const line of run.badTraceLines) failures.push(`TRACE-1 invalid JSON line: ${line.slice(0, 80)}`);
  for (const line of run.trace) {
    if (!('timestamp' in line && 'work_order_id' in line && 'event_type' in line && 'detail' in line)) failures.push(`TRACE-1 missing field in ${line.event_type}`);
    if (['uncaught_exception', 'unhandled_rejection', 'run_error', 'stderr'].includes(line.event_type)) failures.push(`RUN-1 trace ${line.event_type}: ${JSON.stringify(line.detail).slice(0, 200)}`);
  }

  const blocks = parseBlocks(run.stdout, failures);
  const events = (type: string): TraceLine[] => run.trace.filter((line) => line.event_type === type);
  const rows = (events('csv_loaded')[0]?.detail['rows'] as { work_order_id?: string }[] | undefined) ?? [];
  const csvIds = rows.map((row) => (row.work_order_id ?? '').trim()).filter((id) => id !== '');
  const language = new Map(events('language_inferred').map((line) => [line.work_order_id ?? '', str(line.detail['language'])]));
  const urgency = new Map(events('order_loaded').map((line) => [line.work_order_id ?? '', str(line.detail['urgency'])]));
  const reported = new Map(events('order_loaded').map((line) => [line.work_order_id ?? '', iso(line.detail['reported_at'])]));
  const simNow = iso(events('run_started')[0]?.detail['sim_now']);

  // ORD-1, ORD-2, ACC-2
  const results = new Map<string, Block>();
  blocks.forEach((block, index) => {
    if (block.kind !== 'result') return;
    if (results.has(block.id)) failures.push(`ORD-1 second result for ${block.id}`);
    results.set(block.id, block);
    if (blocks.slice(index + 1).some((later) => later.id === block.id)) failures.push(`ORD-2 output for ${block.id} after its result`);
    if (block.result === 'scheduled') {
      const before = blocks.slice(0, index).filter((earlier) => earlier.id === block.id).slice(-2);
      const roles = before.map((earlier) => earlier.role).sort().join(',');
      if (roles !== 'handyman,tenant' || !before.every((earlier) => /^Confirm/.test(earlier.body))) failures.push(`ACC-2 ${block.id} scheduled without confirmations to both just before`);
    }
  });
  for (const id of new Set(csvIds)) if (!results.has(id)) failures.push(`ORD-1 no result for ${id}`);

  // COM-1, COM-2, COM-3, REQ-ST-4
  const seenTenant = new Set<string>();
  for (const block of blocks.filter((candidate) => candidate.kind === 'frame')) {
    const want = block.role === 'handyman' ? 'es' : language.get(block.id);
    const got = languageOf(block.body);
    if (want !== undefined && got !== null && got !== want) failures.push(`COM-${block.role === 'handyman' ? 1 : 2} ${block.id} ${block.role ?? ''} frame not in ${want}: ${block.body.slice(0, 90)}`);
    if (/(propo|propuesta|Confirm|recuerdo|reminder)/i.test(block.body) && /\d{1,2}:\d{2}/.test(block.body) && !WEEKDAYS.test(block.body)) failures.push(`COM-3 ${block.id} frame lacks an absolute weekday, date and range: ${block.body.slice(0, 90)}`);
    if (block.role === 'tenant' && !seenTenant.has(block.id)) {
      seenTenant.add(block.id);
      if (urgency.get(block.id) === 'Critical' && !block.body.includes('112')) failures.push(`REQ-ST-4 first message to the Critical tenant of ${block.id} lacks 112`);
    }
  }

  // LLM-2: a party's text never reaches the other party
  for (const line of events('line_classified').filter((candidate) => candidate.detail['classification'] === 'message')) {
    const body = str(line.detail['body']);
    if (body.length < 14 || body === '<NO RESPONSE>') continue;
    const other = line.detail['role'] === 'tenant' ? 'handyman' : 'tenant';
    if (blocks.some((block) => block.role === other && block.body.includes(body))) failures.push(`LLM-2 ${str(line.detail['role'])} text forwarded to ${other}: ${body.slice(0, 60)}`);
  }
  for (const rule of scenario.mustNotReach ?? []) {
    if (blocks.some((block) => block.role === rule.role && block.body.includes(rule.text))) failures.push(`LEAK "${rule.text}" reached the ${rule.role}`);
  }

  // SCHED-1, SCHED-2, SCHED-3, SCHED-5, REQ-NG-11
  const live = new Map<string, { s: DateTime; e: DateTime }>();
  const scheduled = new Set<string>();
  const current = new Map<string, { s: DateTime; e: DateTime }>();
  const refused = new Map<string, { s: DateTime; e: DateTime }[]>();
  for (const line of run.trace) {
    const id = line.work_order_id ?? '';
    if (line.event_type === 'hold_taken') {
      const slot = { s: iso(line.detail['start']), e: iso(line.detail['end']) };
      if (slot.e.diff(slot.s, 'minutes').minutes !== 120) failures.push(`SCHED-2 ${id} hold ${str(line.detail['start'])} is not 2 hours`);
      const notBefore = reported.get(id);
      if ((simNow.isValid && slot.s < simNow) || (notBefore?.isValid === true && slot.s < notBefore)) failures.push(`SCHED-5 ${id} hold ${str(line.detail['start'])} before the reference time or reported_at`);
      for (const [other, held] of live) if (other !== id && overlap(slot, held)) failures.push(`SCHED-1 ${id} hold ${str(line.detail['start'])} overlaps ${other}`);
      live.set(id, slot);
      current.set(id, slot);
    }
    if (line.event_type === 'hold_released') {
      if (scheduled.has(id)) failures.push(`SCHED-3 scheduled ${id} released (${str(line.detail['reason'])})`);
      live.delete(id);
    }
    if (line.event_type === 'result' && line.detail['kind'] === 'scheduled') scheduled.add(id);
    if (line.event_type === 'decision' && line.detail['outcome'] === 'takeover') {
      const victim = str(line.detail['from']);
      if (!((RANK[urgency.get(id) ?? ''] ?? 9) < (RANK[urgency.get(victim) ?? ''] ?? -1))) failures.push(`SCHED-4 ${id} took over ${victim} without strictly higher urgency`);
    }
    if (line.event_type === 'decision' && line.detail['outcome'] === 'repropose') {
      const cause = str(line.detail['cause']);
      const list = refused.get(id) ?? [];
      const before = current.get(id);
      if (['decline', 'counter', 'no_fit', 'withdraw'].includes(cause) && before !== undefined) list.push(before);
      refused.set(id, list);
      const chosen = { s: iso(line.detail['start']), e: iso(line.detail['end']) };
      if (['decline', 'no_fit', 'preempted', 'blackout'].includes(cause)) {
        for (const slot of list) if (overlap(chosen, slot)) failures.push(`REQ-NG-11 ${id} v${String(line.detail['version'])} (${cause}) ${str(line.detail['start'])} overlaps a refused slot`);
      }
    }
  }

  // TIME-1, ACC-3
  for (const [id, block] of results) {
    if (block.result !== 'scheduled') continue;
    const at = (block.extra ?? '').slice('SCHEDULED_FOR:'.length);
    const parsed = DateTime.fromISO(at, { setZone: true });
    if (!parsed.isValid || parsed.offset !== parsed.setZone('Europe/Madrid').offset) failures.push(`TIME-1 ${id} SCHEDULED_FOR ${at} has the wrong offset`);
    const traced = events('result').find((line) => line.work_order_id === id);
    if (traced?.detail['scheduledFor'] !== at) failures.push(`ACC-3 ${id} stdout ${at} differs from the trace ${str(traced?.detail['scheduledFor'])}`);
  }

  // Expectations of the scenario
  for (const [id, expected] of Object.entries(scenario.expect)) {
    if (expected === null) continue;
    const block = results.get(id);
    const traced = events('result').find((line) => line.work_order_id === id);
    const code = str(traced?.detail['code']);
    if (block === undefined || block.result !== expected.result) {
      const got = block === undefined ? 'nothing' : `${block.result ?? ''} ${block.result === 'scheduled' ? (block.extra ?? '').slice(14) : code}`;
      failures.push(`EXPECT ${id}: wanted ${expected.result}${expected.codes ? ` ${expected.codes.join('|')}` : ''}${expected.at ? ` ${expected.at}` : ''}, got ${got}`);
      continue;
    }
    const at = (block.extra ?? '').slice('SCHEDULED_FOR:'.length);
    if (expected.at !== undefined && at !== expected.at) failures.push(`EXPECT ${id}: wanted at ${expected.at}, got ${at}`);
    if (expected.date !== undefined && !at.startsWith(expected.date)) failures.push(`EXPECT ${id}: wanted date ${expected.date}, got ${at}`);
    if (expected.notAt !== undefined && at === expected.notAt) failures.push(`EXPECT ${id}: must not be at ${expected.notAt}`);
    if (expected.codes !== undefined && !expected.codes.includes(code)) failures.push(`EXPECT ${id}: wanted code ${expected.codes.join('|')}, got ${code}`);
  }
  for (const wanted of scenario.traceHas ?? []) {
    const found = run.trace.some((line) => line.event_type === wanted.event_type && Object.entries(wanted.match ?? {}).every(([key, value]) => line.detail[key] === value));
    if (!found) failures.push(`TRACE expected ${wanted.event_type} ${JSON.stringify(wanted.match ?? {})}`);
  }
  return failures;
}
