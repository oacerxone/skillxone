# Pro accounts (Razorpay)

skillxone is free to search, and every skill's security report and verification status is
free. An operator can offer a paid **Pro** plan that unlocks the advanced Explore filters:
agent, repository stars, licence, update date, instructions-only, and the Rising and Best
maintained sorts.

Pro features are gated **only when billing and sign-in are both configured**. Without them
nobody could pay, so every filter stays open to everyone. The public JSON API is not gated;
the skillxone agent skills depend on it.

## Set up

1. **Sign-in.** Create a GitHub OAuth app (Settings → Developer settings → OAuth Apps) with
   the callback URL `https://YOUR_SITE/auth/github/callback`, and set
   `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.
2. **Razorpay account.** Enable Subscriptions. To charge in USD, international card payments
   must be enabled on the account; Razorpay bills international currencies on cards only.
   Settlement currency and eligibility depend on your account, so confirm them with Razorpay.
3. **Plan.** In the Razorpay dashboard, create a monthly plan (for example USD 5). Its amount
   and currency are set there; set `PRO_PRICE_LABEL` to the same price so the site shows it.
4. **API keys.** Generate a key pair and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
5. **Webhook.** Add a webhook to `https://YOUR_SITE/api/billing/razorpay` with the
   `subscription.*` events, choose a secret, and set it as `RAZORPAY_WEBHOOK_SECRET`.
6. Set `RAZORPAY_PLAN_ID` and restart the app.

Test with Razorpay test-mode keys first.

## How it works

- `/pricing` shows the plans. A signed-in user's **Upgrade** button posts to
  `/billing/checkout` (same-site, CSRF-protected), which creates a subscription through
  Razorpay's API, stores it against the user, and redirects to Razorpay's hosted payment page.
  No card data reaches this site.
- The webhook is authenticated by the HMAC-SHA256 signature over the raw body. The handler
  then fetches the subscription from Razorpay's API and copies its current status, so a late,
  repeated or forged-but-replayed payload cannot set a wrong state. Delivery ids are recorded
  to ignore repeats; a failure answers non-2xx so Razorpay retries.
- A user has Pro while their subscription status is `active`, `authenticated` or `pending`.
- `/account` shows the plan and lets the user cancel at the end of the paid period.
- Pro filters are removed from the request before the query runs (and before the result
  cache), so cached results can never reach a viewer without Pro.
