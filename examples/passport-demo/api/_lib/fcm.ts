/**
 * One FCM HTTP v1 send. DATA-ONLY, so Passport's own service worker draws the
 * notification (`public/sw.js`, the `push` handler) and nothing in the message
 * names an amount, a person, or an address.
 */

export const PUSH_TITLE = 'You received a payment';
export const PUSH_BODY = 'Open Passport to see it.';

export type SendOutcome = 'sent' | 'stale' | 'failed';

export interface FcmContext {
  projectId: string;
  accessToken: string;
  fetch: typeof fetch;
}

export function paymentMessage(token: string, txHash: string): unknown {
  return {
    message: {
      token,
      webpush: {
        headers: { TTL: '3600', Urgency: 'high' },
        data: { title: PUSH_TITLE, body: PUSH_BODY, txHash, url: '/' },
      },
    },
  };
}

interface FcmError {
  error?: { status?: string; details?: { errorCode?: string }[] };
}

/**
 * Sends to one token. `stale` means the token will never work again and should
 * be dropped: FCM answered 404, UNREGISTERED, or INVALID_ARGUMENT.
 */
export async function sendPayment(context: FcmContext, token: string, txHash: string): Promise<SendOutcome> {
  try {
    const response = await context.fetch(
      `https://fcm.googleapis.com/v1/projects/${context.projectId}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentMessage(token, txHash)),
      },
    );
    if (response.ok) return 'sent';
    if (response.status === 404) return 'stale';
    const body = (await response.json().catch(() => ({}))) as FcmError;
    const codes = [body.error?.status, ...(body.error?.details ?? []).map((detail) => detail.errorCode)];
    if (codes.includes('UNREGISTERED') || codes.includes('INVALID_ARGUMENT')) return 'stale';
    return 'failed';
  } catch {
    return 'failed';
  }
}
