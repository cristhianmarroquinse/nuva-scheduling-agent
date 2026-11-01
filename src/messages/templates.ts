// Message templates (REQ-OUT-2, REQ-OUT-3, REQ-ST-4). Handyman always in Spanish (COM-1); tenant in the order's language
// (COM-2); every date absolute with weekday and time range in Madrid time (COM-3). No model text here.

import type { Slot } from '../calendar/calendar.js';
import { singleLine } from '../io/frames.js';
import type { Urgency } from '../orders/validate.js';
import { timeRange, weekdayDate, type Language } from '../time/format.js';
import { parseLocalOrOffset } from '../time/time.js';

const URGENCY_ES: Record<Urgency, string> = { Critical: 'crítica', High: 'alta', Medium: 'media', Low: 'baja' };

const EMERGENCY_CLAUSE: Record<Language, string> = {
  es: 'Si hay peligro inmediato, llame al 112.',
  en: 'If there is immediate danger, call 112.',
};

/** "jueves 5 de noviembre de 2026, de 10:00 a 12:00 (hora de Madrid)" / "Thursday 5 November 2026, 10:00 to 12:00 (Madrid time)". */
export function slotText(slot: Slot, language: Language): string {
  const start = parseLocalOrOffset(slot.start);
  const end = parseLocalOrOffset(slot.end);
  if (start === null || end === null) throw new Error(`Unreadable slot ${slot.start} – ${slot.end}`);
  const zone = language === 'es' ? 'hora de Madrid' : 'Madrid time';
  return `${weekdayDate(start, language)}, ${timeRange(start, end, language)} (${zone})`;
}

export interface TenantProposal {
  language: Language;
  title: string;
  slot: Slot;
  critical: boolean;
}

/** First message to the tenant: the issue, one concrete slot, how to answer; Critical adds the 112 clause (REQ-ST-4). */
export function initialProposalToTenant({ language, title, slot, critical }: TenantProposal): string {
  const issue = singleLine(title);
  const when = slotText(slot, language);
  const body =
    language === 'es'
      ? `Hola. Le escribimos por su aviso «${issue}». Proponemos la visita del técnico el ${when}. ¿Le viene bien? Si no, indíquenos qué días y horas le vendrían bien.`
      : `Hello. We are writing about your report "${issue}". We propose the handyman's visit on ${when}. Does that work for you? If not, please tell us which days and times would suit you.`;
  return critical ? `${body} ${EMERGENCY_CLAUSE[language]}` : body;
}

export interface HandymanProposal {
  title: string;
  address: string;
  urgency: Urgency;
  slot: Slot;
}

/** First message to the handyman, always Spanish: the job, its urgency, where, one concrete slot, how to answer. */
export function initialProposalToHandyman({ title, address, urgency, slot }: HandymanProposal): string {
  return `Nueva visita propuesta para el aviso «${singleLine(title)}» (urgencia ${URGENCY_ES[urgency]}) en ${singleLine(address)}. Propuesta: ${slotText(slot, 'es')}. ¿Te viene bien? Si no, dime qué disponibilidad tienes.`;
}
