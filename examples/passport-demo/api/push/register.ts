/**
 * Stores this browser's FCM token against a Passport account. POST { account,
 * token }. See `../_lib/handlers.ts`.
 */

import { handleRegister } from '../_lib/handlers.js';
import { nodeHandler } from '../_lib/http.js';

export default nodeHandler(handleRegister);
