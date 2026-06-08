/**
 * Action types for human-oversight receipts. A human reviewer's decision is recorded as an
 * ordinary receipt — signed by the reviewer's own key, witnessed, and linked via `prev` to
 * the action receipt under review — so the oversight step lives in the same evidence chain.
 */
export const HUMAN_APPROVAL = "human.approval";
export const HUMAN_REJECTION = "human.rejection";

/** True if the action type denotes a human oversight decision. */
export function isHumanDecision(actionType: string): boolean {
  return actionType === HUMAN_APPROVAL || actionType === HUMAN_REJECTION;
}
