// End-to-end scenarios run against the built agent and the real model (spec 014). Data only: the CSV rows, the stdin
// lines, the reference time and what each order should end as. `pnpm e2e` runs them; `pnpm test` only checks they load.

export const HEADER = 'work_order_id,work_order,address,description,reported_at,urgency';

/** What one order should end as. Omitted fields are not checked. */
export interface Expect {
  result: 'scheduled' | 'requires_review';
  /** Exact `SCHEDULED_FOR`. */
  at?: string;
  /** `SCHEDULED_FOR` must start with this date. */
  date?: string;
  /** `SCHEDULED_FOR` must not be this. */
  notAt?: string;
  /** Allowed review reason codes. */
  codes?: string[];
}

export interface Scenario {
  name: string;
  /** One line: the rule the scenario exercises. */
  about: string;
  /** `AGENT_NOW`, Madrid wall clock; default Wednesday 2026-11-04 10:00. */
  now?: string;
  /** Data rows; the header is added by the runner. */
  csv: string[];
  stdin: string[];
  /** Per order id; `null` when the outcome is open and only the invariants are checked. */
  expect: Record<string, Expect | null>;
  /** Text that must never appear in a frame to that role (no forwarding, no leaks). */
  mustNotReach?: { role: 'tenant' | 'handyman'; text: string }[];
  /** A trace event that must exist, optionally with detail fields equal to these values. */
  traceHas?: { event_type: string; match?: Record<string, unknown> }[];
}

export const DEFAULT_NOW = '2026-11-04T10:00';
