import { audit, corsHeaders, HttpError, json, requireCaller } from "../_shared/guard.ts"
import { handleAccountControl } from "../_shared/accountControlHandler.ts"
import { verifyTotpCode } from "../_shared/stepUp.ts"
import type { FetchLike } from "../_shared/emailTest.ts"

// Super Admin account deletion (verify_jwt stays ON). Only a Super Admin whose session passed the authenticator may call it, and the delete action asks for a FRESH
// authenticator code, the exact phrase `DELETE <email>` and a written reason. The database decides whether the account is removed completely (no records) or closed
// with every record kept; see supabase/migrations/20261101230000_account_deletion.sql. The decisions live in ../_shared/accountControlHandler.ts (tested in Node).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  try {
    const caller = await requireCaller(req)
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    const body = await req.json().catch(() => ({}))
    const reply = await handleAccountControl(body, {
      caller: { id: caller.id, role: caller.role },
      rpc: (name, args) => caller.admin.rpc(name, args),
      removeFiles: async (bucket, paths) => {
        if (!paths.length) return 0
        const { data } = await caller.admin.storage.from(bucket).remove(paths)
        return data?.length ?? 0
      },
      listAvatars: async (userId) => {
        const { data } = await caller.admin.storage.from("avatars").list(userId)
        return (data ?? []).map((file) => `${userId}/${file.name}`)
      },
      deleteAuthUser: async (id) => {
        const { error } = await caller.admin.auth.admin.deleteUser(id)
        return error ? { message: error.message } : null
      },
      lockAuthUser: async (id) => {
        const { error } = await caller.admin.auth.admin.updateUserById(id, { email: `deleted-${id}@erased.invalid`, user_metadata: {}, ban_duration: "876000h" })
        return error ? { message: error.message } : null
      },
      audit: (action, targetId, details) => audit(caller, action, targetId, details),
      stepUp: (code) => verifyTotpCode({ baseUrl: Deno.env.get("SUPABASE_URL")!, anonKey: Deno.env.get("SUPABASE_ANON_KEY")!, token, code, fetchImpl: fetch as unknown as FetchLike }),
    })
    return json(reply.body, reply.status)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: "Server error" }, 500)
  }
})
