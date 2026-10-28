/**
 * Entry of the account Worker; the routes are in handler.ts. Only the handler is exported here:
 * the Workers runtime refuses other exports of the entry module.
 */
import { createHandler, type Env } from './handler.ts'
import { simpleWebAuthn } from './passkeys.ts'
import { D1Store } from './store.ts'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createHandler({ store: new D1Store(env.DB), passkeys: simpleWebAuthn })(request, env.ALLOWED_ORIGINS)
  },
}
