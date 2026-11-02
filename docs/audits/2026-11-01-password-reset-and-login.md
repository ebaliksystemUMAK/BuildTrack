# 2026-11-01 Password reset (link or code), login register button, sign-up code check

No migration, no Edge Function change, no live-data change. Screens on the branch only until merged and deployed. Two settings must be changed by the owner in the Supabase dashboard (below).

## What was wrong
- **The reset link never asked for a new password.** `Forgot password?` called `resetPasswordForEmail(... redirectTo: /login)`. Opening that link signs the person in with a one-time session, and nothing in the app handled the recovery event, so the guard sent them straight to their workspace. The password was never changed and the link worked as a one-click sign-in. There was no screen where a new password was entered.
- **No code option.** Only the link existed.

## What changed
| Where | Change |
|---|---|
| `pages/Auth/ForgotPasswordPage.tsx` (`/forgot-password`) | Enter the email, then choose "Email me a reset link" or "Email me a 6-digit code instead". Both send the same reset email, which carries the button AND the code; the choice only decides which screen follows. The answer is the same whether or not the address has an account (no account discovery). 60-second resend countdown; rate-limit and offline messages. |
| `pages/Auth/ResetPasswordPage.tsx` (`/reset-password`) | The one screen both ways end on: new password + confirm with the same 12-character policy and strength list as registration, then `updateUser`, the one-time session is ended and the person signs in again with the new password. Cancel signs out. An expired / used / missing link says so. |
| `lib/passwordRecovery.ts` | Remembers "this person is mid-reset" (tab only, survives a reload) and reads the link's markers when the app starts, before the auth client removes them. |
| `components/RouteGuard.tsx`, `lib/auth.tsx` | While a reset is in progress the person is kept on the reset screen and never reaches a workspace (this closes the sign-in-by-link gap). Admin / Super Admin accounts still pass the authenticator step first (Supabase also requires it before a password change). |
| `pages/Auth/LoginPage.tsx` | `Forgot password?` opens the new screen (a typed email is carried over). The small "Register" text link became a full-width orange **Create an account** button directly under the login button. |
| `supabase/email-templates/reset-password.html` + README | The email now shows the 6-digit code under the button and says the link and the code last 10 minutes. |

## Sign-up code (checked, unchanged)
Email sign-up already sends a 6-digit code first and the person cannot sign in until it is entered: `signUp` -> code -> `verifyOtp` -> sign out -> sign in -> request access (an administrator then approves). Evidence on the real project: all 13 accounts are confirmed and none ever signed in unconfirmed, so "Confirm email" is on. Google sign-ups skip the code because Google has already verified the email; they still wait for administrator approval before any access.

## Owner steps (Supabase dashboard; the agent cannot change Auth settings)
1. **Authentication > Emails > Templates > Reset password**: paste the new `supabase/email-templates/reset-password.html`, subject `Reset your BuildTrack password`. Without the `{{ .Token }}` in the template the "code" choice cannot work (the link choice still does).
2. **Authentication > URL Configuration > Redirect URLs**: add `https://valencia-buildtrack.vercel.app/reset-password` and `http://localhost:8443/reset-password` (and `http://localhost:8444/reset-password` if the dev server moves to that port). Supabase only redirects to listed addresses; otherwise the link lands on the Site URL.
3. Confirm **Email OTP Expiration = 600** and **Email OTP Length = 6** (README section 1).
4. Try it with an account you own: both choices, a wrong code, a used link.

## Tests
`pnpm test:password-recovery` (store and link markers, both choices, code order "note starts before the code signs the person in", every error message, the new-password screen order "save, end the note, notice, sign out", cancel, guard / routes / login button / template checks). Checked in a real browser against the live project: login page, forgot screen, code step with the countdown, wrong code message, reset screen with no session and with an expired-link address. The happy path (a real code from a real email) needs the template change above.
