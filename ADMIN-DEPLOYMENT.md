# Deploy admin review and live totals

## Render environment

Keep the existing `DATABASE_URL`. Add:

| Key | Value |
| --- | --- |
| `ADMIN_USERNAME` | Your chosen admin username; defaults to `admin` |
| `ADMIN_PASSWORD` | A unique password of at least 16 characters |
| `SESSION_SECRET` | A separate random secret of at least 32 characters |

Generate a session secret locally with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Save that output directly in Render's Environment settings. Never place real passwords or secrets in source control. Configure these same keys in `.env` for local Docker Compose.

This version uses one configured admin account. Multiple administrators can use concurrent sessions, but their audit entries use the same configured account name. Individual admin accounts and role management are not implemented.

## Upgrade the database and deploy

Push this source update to the repository connected to Render and redeploy. The new Dockerfile automatically runs `node scripts/setup.js` before starting the web server. It adds `submission_reviews` and `review_events` plus supporting indexes without changing submitted vote records. Existing submissions start pending; none are automatically approved.

If Render has a custom **Docker Command**, set it to:

```sh
sh -c "node scripts/setup.js && exec node server.js"
```

An old `node server.js` override bypasses the new database setup. The database setup is repeatable and serialized with a database lock. Use `/healthz` as Render's health-check path. The app enables Render's forwarded-IP/protocol handling when Render supplies `RENDER=true`.

For a local installation run `npm install`, `npm run db:setup`, and `npm start`. For Compose run `docker compose up --build -d`. The container is restarted automatically if database setup fails; inspect setup/app logs rather than repeatedly retrying manual schema changes.

## Review submissions

Open your deployed site's `/#admin` page, or choose **Admin review** from the navigation. Sign in with your configured username and password.

- New reports are pending and hidden from public results and totals. Their attachment is accessible only to authenticated admins until approval.
- The queue groups reports by polling unit, election type and date, and shows all three slots side by side, including each original result sheet. Search by location or polling-unit code. Empty slots are explicitly labelled.
- Approve one report after checking it against the original sheet. Its votes count once at every geographic level. Other reports remain available for comparison; they do not add extra votes.
- Reject inaccurate reports with a review note. Rejection does not free their submission slot.
- To replace an approved report, first **Return to pending**, recording the reason. Then approve the correct report. While no report is approved, that unit contributes no votes. The original reports and audit events remain immutable.
- Approval, rejection and return-to-pending decisions require a note and record the account, timestamp and previous/new status. The queue shows the latest 20 events per report; full history remains in `review_events`.

Sign-in uses an HTTP-only, SameSite cookie with an eight-hour signed session. HTTPS is required in production. Rotating `SESSION_SECRET` invalidates existing sessions. Login attempts are rate-limited. Changing only `ADMIN_PASSWORD` does not invalidate an already-issued session, so rotate `SESSION_SECRET` too when revoking access.

## Live totals

Open `/#live` or choose **Live vote totals**. Select the election and date, choose Nation / State / Local government / Ward / Polling unit, and optionally filter to a specific location. Totals refresh every 15 seconds while the page is visible. Admin queues also refresh every 15 seconds, except while a review decision dialog is open.

Each party appears with its full name and accumulated votes. A leading party is green; trailing parties are red. Equal positive leaders are green and labelled **Joint lead**; all-zero totals have no leader. Pending/rejected reports are excluded. Parties not entered on a report are not confirmed to have zero votes. These are partial, admin-reviewed community reports, not official election declarations. Legislative party totals combine reports for the selected election type/date; the application does not model candidate constituencies or declare elected candidates.

Totals are calculated from the entire approved dataset, not the latest-100 results feed. Tables are paginated at 50 geographic groups per page; the admin queue shows 20 unit/election groups per page and always includes all available submissions for each group. Approval changes are transactionally serialized, and a database partial unique index independently prevents multiple approved reports for the same unit/election/date.

## Verification

`npm test` includes an isolated PostgreSQL-compatible runtime via the development-only PGlite dependency. It tests immutable submissions, the review audit, duplicate approvals, replacement/revocation, approval-only public reports, totals at every geographic level, location scope, election/date separation, party ties, and admin authentication. This does not connect to or modify Neon.
