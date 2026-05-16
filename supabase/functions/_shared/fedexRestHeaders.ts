export const fedexAuthorizedJsonHeaders = (
  accessToken: string,
  customerTransactionId = crypto.randomUUID(),
): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "X-locale": "en_US",
  "x-customer-transaction-id": customerTransactionId,
});
