/**
 * Announces a payment to a Passport account, once it is verified on the
 * indexer. POST { recipientAccount, txHash }. See `../_lib/handlers.ts`.
 */

import { handleNotify } from '../_lib/handlers.js';
import { nodeHandler } from '../_lib/http.js';

export default nodeHandler(handleNotify);
