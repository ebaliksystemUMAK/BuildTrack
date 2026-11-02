# BuildTrack email setup (Supabase Auth + Brevo)

These two settings are **Supabase Auth settings, not database data**, so the agent cannot change them with the database connector. Do them once in the dashboard of the BuildTrack project.

## 1. Keep the code at 6 digits
Authentication → **Sign In / Providers** → **Email** → set **Email OTP Length** to `6` and **Email OTP Expiration** to `600` seconds → Save.

The sign-up screen accepts 6 to 10 digits, so it works whatever the setting is, but the email you see follows this setting.

## 2. Install the designed emails
Authentication → **Emails** → **Templates**.

| Template in Supabase | Paste the HTML from | Subject line |
|---|---|---|
| **Confirm sign up** (this is the OTP email) | `confirm-signup.html` | `Your BuildTrack verification code` |
| **Reset password** | `reset-password.html` | `Reset your BuildTrack password` |

Rules:
- Keep `{{ .Token }}` (the 6-digit code) in the sign-up template. Do not use `{{ .ConfirmationURL }}` there, or the email would send a link instead of a code.
- The reset template is the link only (`{{ .ConfirmationURL }}`). The "6-digit code" choice on the Forgot password screen does NOT use this template: BuildTrack's own `email-code` function makes, emails and checks that code (needs `BREVO_API_KEY` and `MAIL_FROM_EMAIL`, see `docs/BUILDTRACK_EMAIL_SETUP.md`), so editing or breaking this template never affects the code.
- The reset link shares the **Email OTP Expiration** of section 1 (10 minutes), so the template says 10 minutes. If you change that setting, change the wording too.
- Sender name/email and the SMTP connection are already set (Brevo).

## 3. Check it
Register a test account with an address you own. You should receive a purple/orange email with a large 6-digit code. If it lands in spam, authenticate your sender domain in Brevo (SPF/DKIM/DMARC).

## Design notes
- Brand colors: magenta `#9E1F93` header, orange `#F18B00` accent bar, plum `#68135F` code.
- Table-based layout with inline styles so it renders in Gmail, Outlook and phones. Both light and dark clients are supported (explicit colors, `color-scheme` meta).
- The hidden preview line shows "Your BuildTrack code is 123456" next to the subject in the inbox.
