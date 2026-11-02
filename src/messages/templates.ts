// Message templates (REQ-OUT-2, REQ-OUT-3, REQ-ST-4). Handyman always in Spanish (COM-1); tenant in the order's language
// (COM-2); every date absolute with weekday and time range in Madrid time (COM-3). No model text here.

import type { Slot } from '../calendar/calendar.js';
import { singleLine, type Role } from '../io/frames.js';
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

/** The message recipient: the tenant is addressed formally (usted), the handyman informally (tú). */
export interface Addressed {
  language: Language;
  to: Role;
}

/** Brief acknowledgement to the first party that accepts (REQ-NG-6): the other party is being awaited. */
export function acknowledgement({ language, to }: Addressed): string {
  if (to === 'handyman') return 'Gracias, anotado. Estamos pendientes de la confirmación del inquilino y te avisamos en cuanto la tengamos.';
  return language === 'es'
    ? 'Gracias, queda anotado. Estamos pendientes de la confirmación del técnico y le avisaremos en cuanto la tengamos.'
    : 'Thank you, noted. We are waiting for the handyman to confirm and will let you know as soon as we have it.';
}

export interface SlotMessage extends Addressed {
  title: string;
  slot: Slot;
}

/** One-line confirmation of the specific slot, asked when an acceptance also carries a constraint (REQ-NG-3). */
export function confirmationRequest({ language, to, title, slot }: SlotMessage): string {
  const issue = singleLine(title);
  if (to === 'handyman') return `Para confirmar: ¿te viene bien la visita por «${issue}» el ${slotText(slot, 'es')}? Responde sí, o dime otra fecha y hora.`;
  return language === 'es'
    ? `Para confirmar: ¿le viene bien la visita por «${issue}» el ${slotText(slot, 'es')}? Responda sí, o indíquenos otra fecha y hora.`
    : `To confirm: does the visit for "${issue}" on ${slotText(slot, 'en')} work for you? Please answer yes, or give us another date and time.`;
}

/** One clarification after a reply that could not be understood (REQ-NG-8): restates the slot, asks for a yes or another time. */
export function clarification({ language, to, title, slot }: SlotMessage): string {
  const issue = singleLine(title);
  if (to === 'handyman') return `Perdona, no he entendido tu respuesta. La visita propuesta por «${issue}» es el ${slotText(slot, 'es')}. ¿Te viene bien? Si no, dime otra fecha y hora.`;
  return language === 'es'
    ? `Disculpe, no hemos entendido su respuesta. La visita propuesta por «${issue}» es el ${slotText(slot, 'es')}. ¿Le viene bien? Si no, indíquenos otra fecha y hora.`
    : `Sorry, we did not understand your reply. The proposed visit for "${issue}" is on ${slotText(slot, 'en')}. Does that work for you? If not, please give us another date and time.`;
}

/** Confirmation to the tenant once both parties accepted (REQ-RES-1, ACC-2). */
export function confirmationToTenant({ language, title, slot }: { language: Language; title: string; slot: Slot }): string {
  const issue = singleLine(title);
  return language === 'es'
    ? `Confirmado: la visita del técnico por «${issue}» queda fijada para el ${slotText(slot, 'es')}. Gracias.`
    : `Confirmed: the handyman's visit for "${issue}" is set for ${slotText(slot, 'en')}. Thank you.`;
}

/** Confirmation to the handyman, always Spanish (REQ-RES-1, ACC-2, COM-1). */
export function confirmationToHandyman({ title, address, slot }: { title: string; address: string; slot: Slot }): string {
  return `Confirmado: visita por «${singleLine(title)}» en ${singleLine(address)}, ${slotText(slot, 'es')}. Gracias.`;
}

export interface Reproposal {
  language: Language;
  title: string;
  slot: Slot;
  /** The party stated times that could not be honoured (REQ-NG-4 with no fit). */
  unavailableNote?: boolean;
}

/** A new proposal to the tenant: the previous one is cancelled in writing (REQ-NG-1). */
export function reproposalToTenant({ language, title, slot, unavailableNote }: Reproposal): string {
  const issue = singleLine(title);
  if (language === 'es') {
    const note = unavailableNote ? ' Las horas que nos indica no están disponibles.' : '';
    return `La propuesta anterior queda cancelada.${note} Nueva propuesta para «${issue}»: ${slotText(slot, 'es')}. ¿Le viene bien? Si no, indíquenos qué días y horas le vendrían bien.`;
  }
  const note = unavailableNote ? ' The times you suggested are not available.' : '';
  return `The previous proposal is cancelled.${note} New proposal for "${issue}": ${slotText(slot, 'en')}. Does that work for you? If not, please tell us which days and times would suit you.`;
}

/** A new proposal to the handyman, always Spanish (REQ-NG-1, COM-1). */
export function reproposalToHandyman({ title, address, slot, unavailableNote }: { title: string; address: string; slot: Slot; unavailableNote?: boolean }): string {
  const note = unavailableNote ? ' Las horas que indicas no están disponibles.' : '';
  return `La propuesta anterior queda cancelada.${note} Nueva propuesta para el aviso «${singleLine(title)}» en ${singleLine(address)}: ${slotText(slot, 'es')}. ¿Te viene bien? Si no, dime qué disponibilidad tienes.`;
}

/** The fixed sentence for anything the facts do not cover (REQ-NG-7). */
export function officeWillCheck({ language, to }: Addressed): string {
  if (to === 'handyman') return 'Lo consulto con la oficina y te digo.';
  return language === 'es' ? 'Lo consultaremos con la oficina y le responderemos.' : 'We will check with the office and get back to you.';
}

/** The answer to a question (model text or the fixed sentence), then a reminder of the slot and how to reply (LLM-2). */
export function answerReply({ language, to, title, slot, answer }: SlotMessage & { answer: string }): string {
  const issue = singleLine(title);
  const reminder =
    to === 'handyman'
      ? `Te recuerdo que la visita propuesta por «${issue}» es el ${slotText(slot, 'es')}. ¿Te viene bien? Si no, dime otra fecha y hora.`
      : language === 'es'
        ? `Le recordamos que la visita propuesta por «${issue}» es el ${slotText(slot, 'es')}. ¿Le viene bien? Si no, indíquenos otra fecha y hora.`
        : `As a reminder, the proposed visit for "${issue}" is on ${slotText(slot, 'en')}. Does that work for you? If not, please give us another date and time.`;
  return `${singleLine(answer)} ${reminder}`;
}

/** One clarification when a reply is about another work order (REQ-NG-10): restates this order and its slot. */
export function crossReferenceClarification({ language, to, title, slot }: SlotMessage): string {
  const issue = singleLine(title);
  if (to === 'handyman') return `Creo que te refieres a otro aviso. Este mensaje es sobre el aviso «${issue}», con visita propuesta el ${slotText(slot, 'es')}. ¿Te viene bien? Si no, dime otra fecha y hora.`;
  return language === 'es'
    ? `Creemos que se refiere a otro aviso. Este mensaje es sobre el aviso «${issue}», con visita propuesta el ${slotText(slot, 'es')}. ¿Le viene bien? Si no, indíquenos otra fecha y hora.`
    : `We think you are referring to another work order. This message is about "${issue}", with a visit proposed on ${slotText(slot, 'en')}. Does that work for you? If not, please give us another date and time.`;
}
