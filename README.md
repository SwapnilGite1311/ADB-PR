# Campus Events — College Event Management

A complete assignment application using **plain HTML, CSS, JavaScript, Express, and MongoDB**. No React, bundler, or frontend build step. Start with `CODE_GUIDE.md` when preparing your explanation; `REQUIREMENTS.md` maps the PDF to the implementation.

## Quick start on Windows (recommended for your presentation)

1. Install **Node.js 24 LTS** from https://nodejs.org/ and reopen your terminal. Node.js 22.12+ is also supported.
2. **Keep a backup of your old project.** Extract the ZIP contents directly into `C:\Users\Swapnil Gite\LAN\Projects\ADB PR`. `package.json` should be directly inside this folder, not inside a second `ADB-PR` folder.
3. Open PowerShell and run:

```powershell
Set-Location "C:\Users\Swapnil Gite\LAN\Projects\ADB PR"
npm install
npm run demo
```

4. Open **http://localhost:3000** on your own computer.

`demo` starts a **real, local MongoDB replica set**, creates sample records, and runs the application. You do not need Atlas, a MongoDB installation, or an `.env` file for this mode. The first run downloads a MongoDB binary, so internet access is required. The local database uses port **27018**. Keep this terminal open; stop it with **Ctrl+C**.

### Public local-demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@campus.example | CampusDemo123! |
| Organizer | organizer@campus.example | CampusDemo123! |
| Student | student@campus.example | CampusDemo123! |

These credentials are **only for the local demonstration**, not for a deployment. Demo data is saved under `.demo-data` between normal restarts; session cookies reset on restart. Re-running the seed does not duplicate records or reset your edits. Start with a fresh demo folder if the original sample dates have passed and you need a fresh presentation dataset.

## Use your own MongoDB database

Use this mode for your own persistent application data rather than the sample accounts.

```powershell
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Edit `.env`:

- Set `MONGO_URI` to your **MongoDB Atlas** connection string, with a database name such as `college_events_assignment`.
- Replace `SESSION_SECRET` with the random value generated above.
- Set `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` of at least 8 characters.
- Keep `BASE_URL=http://localhost:3000` for your local computer. Change it to the exact application origin if hosted elsewhere.
- Keep `NODE_ENV=development` while demonstrating locally.

```powershell
npm start
```

The first start creates the admin account if none exists. Subsequent starts do **not** reset its password. Students and organizers sign up in the UI. An admin confirms organizer registration numbers against college records and verifies them in the dashboard.

**Use a new database for this version.** The original app stored passwords as plain text and used a different schema; this project does not silently migrate old data. Rotate the database password that appeared in the supplied source. Never put `.env`, database connection strings, or real passwords on GitHub.

### Atlas setup

1. Create a cluster at https://www.mongodb.com/atlas.
2. Add a database user and allow only the IP address of the computer running the app.
3. Copy the Node.js driver URI from **Connect → Drivers**, fill in the database username/password, and add the database name. URL-encode special password characters.
4. Store the URI only in `.env`.

MongoDB **must be a replica set or Atlas**, because seat allocation, venue booking, and waitlist promotion use transactions. A standalone MongoDB instance is not enough.

### Optional locally installed MongoDB

With MongoDB Community and `mongosh` installed, start a replica set (PowerShell; adjust executable paths if necessary):

```powershell
New-Item -ItemType Directory -Force .mongo-data
mongod --dbpath .mongo-data --replSet rs0 --bind_ip 127.0.0.1 --port 27017
```

In a second terminal, initialize it **once**:

```powershell
mongosh --eval "rs.initiate()"
```

Then use the local replica-set URI shown in `.env.example`. These Windows commands are provided for setup guidance; automated verification was performed on Linux, not on your Windows machine.

## Email confirmation and notifications

- Without SMTP in development mode, signup displays a local email-confirmation link. Open it, then log in.
- With SMTP configured, the confirmation link is emailed. Tokens expire after 24 hours and can be used once.
- Production does not expose a confirmation-link preview. SMTP must be configured for real signup delivery.
- Event updates, RSVP confirmations, waitlist promotions, organizer replies, and reminders appear in the in-app notification inbox. Reminders run every minute for events beginning within 24 hours, respecting student preferences.
- No real email service was used during automated testing.

## Presentation workflow

1. Browse events anonymously and show search/category/date/location filters.
2. Log in as admin: show venues, organizer verification, event moderation, and reports.
3. Log in as organizer: create an event, add a poster and budget breakdown, and submit it for approval.
4. Approve it as admin. Editing a published event sends it back for approval.
5. As student, reserve a seat and view the QR ticket in **My campus**. Register another student for a one-seat event to demonstrate the waitlist; cancel the first registration to show promotion.
6. Check-in opens at the event start. Organizers scan the QR ticket with a phone or external scanner and enter its code, or use the attendee check-in button. No built-in camera scanner is required.
7. Use the seeded **Creative coding recap** event to show completed attendance, editable student feedback, sentiment, organizer responses, and admin execution evaluation.
8. Show attendee connections (both students must opt in), notifications, report exports, and screenshot-supported bug reports with admin progress tracking.

## Checks

```powershell
npm run lint
npm run typecheck
npm test
npm audit
```

Tests use a separate disposable **real MongoDB replica set**, not your configured database. They download MongoDB on the first run. ESLint and TypeScript check the existing JavaScript; you do not need to learn or write TypeScript to explain the app. `types.d.ts` only describes our custom request/session fields for the checker.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run demo` | Local sample app without credentials |
| `npm start` | Run with your `.env` database |
| `npm run dev` | Restart automatically when backend JavaScript changes |
| `npm run seed` | Add public demo accounts/events to the development database in `.env` (do not use with real user data) |

## Important choices and limits

- The PDF does not specify a budget threshold; `BUDGET_THRESHOLD` defaults to **10000**. Above it, detailed amounts must sum to the total budget.
- Event-date uniqueness uses the **UTC calendar date**. The UI displays dates/times in the browser's local timezone.
- Sentiment is a short positive/negative-word list, and themes are word-frequency counts, not machine-learning analysis.
- Recommendations use interests and previously attended categories.
- Organizer verification is a manual admin decision, not an external registry integration.
- Deletes generally deactivate/archive data so reports retain history. Cancel an upcoming event before archiving it.
- JPG/PNG files are capped at 5 MB and compressed within 1200 × 800 pixels; screenshots are private to their uploader and admins.
- Production hosting needs HTTPS, private credentials, correctly configured email, backups, monitoring, and any additional institutional policies. This is an assignment application, not a production deployment.

## Troubleshooting

- **`npm` not recognized:** install Node.js, reopen PowerShell, and check `node --version` and `npm --version`.
- **PowerShell blocks `npm.ps1`:** use `npm.cmd install` and `npm.cmd run demo`, or use Command Prompt. Do not disable system security policies.
- **Port already used:** stop the other app on 3000/27018. For the web port, set `$env:PORT=3001` and `$env:BASE_URL="http://localhost:3001"` before starting.
- **MongoDB download blocked:** use your own Atlas database and `npm start` instead of demo mode.
- **Atlas connection failed:** check your URI, password encoding, database-user permissions, and IP allowlist.
- **Transaction error:** use Atlas or a replica set, not standalone MongoDB.
- **No events visible:** approve a future event and check your filters; expired seed dates are not automatically rewritten.
- **Email unconfirmed:** open the development confirmation link or the email link. Expired or failed email delivery requires administrator assistance.
