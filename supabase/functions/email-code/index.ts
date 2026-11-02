import { createClient } from "npm:@supabase/supabase-js@2"
import { corsHeaders, json } from "../_shared/guard.ts"
import { handleCode, type CodeAdmin } from "../_shared/codeHandler.ts"
import type { FetchLike } from "../_shared/emailTest.ts"

// Emailed 6-digit codes (verify_jwt stays ON: a signed-out visitor calls it with the project's public key). Two jobs:
//   * "send_reset" / "verify_reset": reset a forgotten password with a code. Open to a signed-out person, so it never says whether an address has an account:
//     the same answer and the same limits (one code a minute, five an hour) apply to every address, and a code is only emailed when the account exists and is active.
//   * "send_register" / "verify_register": prove that the signed-in person owns their address. Without it a registration or an access request is refused by the database.
// A code is stored only as an HMAC, works once, lives 10 minutes and allows 5 tries (all enforced in the database functions issue_email_code / consume_email_code).
// The decisions live in ../_shared/codeHandler.ts (tested with `pnpm test:email-codes`); this file only connects the real database, secrets and network.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } })
    const body = await req.json().catch(() => ({}))
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    const reply = await handleCode({ body, token }, { admin: admin as unknown as CodeAdmin, read: (name) => Deno.env.get(name), fetchImpl: fetch as unknown as FetchLike, serviceKey, log: (message) => console.error(message) })
    return json(reply.body, reply.status)
  } catch (err) {
    console.error(err)
    return json({ error: "Server error" }, 500)
  }
})
