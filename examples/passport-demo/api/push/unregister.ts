/**
 * Removes one FCM token from a Passport account. POST { account, token }. See
 * `../_lib/handlers.ts`.
 */

import { handleUnregister } from '../_lib/handlers.js';
import { nodeHandler } from '../_lib/http.js';

export default nodeHandler(handleUnregister);
