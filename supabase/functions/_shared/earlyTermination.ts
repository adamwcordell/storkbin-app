export const MINIMUM_TERM_MONTHS = 12;
export const EARLY_TERMINATION_FEE_CENTS = 9900;

export function isWithinMinimumTerm(subscriptionStartedAt: string | null): boolean {
  if (!subscriptionStartedAt) return false;
  const startedAt = new Date(subscriptionStartedAt);
  if (Number.isNaN(startedAt.getTime())) return false;
  const minimumTermEnd = new Date(startedAt);
  minimumTermEnd.setMonth(minimumTermEnd.getMonth() + MINIMUM_TERM_MONTHS);
  return minimumTermEnd.getTime() > Date.now();
}

export function computeEarlyTerminationPenaltyCents(
): {
  amountCents: number;
} {
  return { amountCents: EARLY_TERMINATION_FEE_CENTS };
}
