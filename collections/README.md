# Receivables Command Center — Payment Reminders & Balances

A single-file web app for chasing **companies that aren't paying their bills**: it tracks
every customer's **current balance**, flags who is past due and by how many days, and
drafts **escalating missed-payment reminder emails** that always include the open-invoice
list and the exact amount owed.

Adapted from the *PC Staffing Command Center* architecture: one HTML file, dark
command-center UI, login gate, tabbed layout, and all data stored in the browser
(`localStorage`) — **no server, no database, no signup required**.

## Run it

- **Locally:** double-click `index.html` (or open it in any modern browser). Everything works offline.
- **On Netlify (this repo):** it deploys with the site and is served at `/collections/`.
- **As its own Netlify site (recommended for Trickster Inc):**
  - *Drag & drop:* zip this folder (or just drag the folder) onto <https://app.netlify.com/drop> — a new site with its own URL exists in ~30 seconds; or
  - *From Git:* Netlify → Add new site → Import from Git → pick this repo → set **Base directory** = `collections` (the `netlify.toml` here handles the rest). Publishes automatically on every push.
- **Logo:** `trickster-logo.svg` — the Trickster Inc jester-shield mark: a three-point jester cap with bells and a jagged grin on a hexagonal shield (scales to any size; also used as the app favicon and header badge).

The landing page is login-only. Two team accounts are built in — `mauruch` and `kfran`
(passwords were provided privately at handoff; SHA-256 hashed, stored in that browser
only). **Change both passwords after first sign-in** via Settings → Change Password
(applies to whichever user is signed in). After the first login, a one-time setup asks
for the business name, contact info, and currency.

Both users share the same accounts/invoice data in a given browser; the activity log
records who signed in and what was done.

## What it does

| Tab | Purpose |
|-----|---------|
| **Dashboard** | Total outstanding, past-due total, aging buckets (current / 1–30 / 31–60 / 61–90 / 90+ days), top balances, and the "send today" reminder queue |
| **Accounts** | Every company that owes you money: contact, terms, balance, past-due amount, status (`CURRENT → OVERDUE → DELINQUENT → COLLECTIONS`), last reminder |
| **Invoices** | Add invoices, record full/partial payments, filter by unpaid/overdue/paid |
| **Reminders** | The core feature — see below |
| **Activity** | Audit trail of everything (invoices added, payments recorded, reminders sent) |
| **Settings** | Business profile, payment instructions, reminder cadence, EmailJS keys, CSV import/export, JSON backup/restore |

## The reminder escalation ladder

Reminder level is suggested automatically from how late the oldest unpaid invoice is,
and escalates one step past the last reminder sent:

| Level | Tone | Triggered at |
|-------|------|--------------|
| L1 | Friendly reminder | 1+ days past due |
| L2 | Past-due notice (pay within 7 days) | 15+ days |
| L3 | Urgent second notice (+ optional late-fee line) | 31+ days |
| L4 | Final notice (account hold / collections warning) | 61+ days |

Every draft automatically includes the **itemized open-invoice table, days late per
invoice, the current balance, and your "how to pay" instructions**. Drafts are fully
editable before sending.

Sending options (any of):

1. **Copy** — paste into any email client.
2. **Open in Mail App** — pre-filled `mailto:` draft to the account's contact.
3. **Send Now (EmailJS)** — optional one-click sending if you add free [EmailJS](https://www.emailjs.com) keys in Settings (template params: `to_email`, `to_name`, `subject`, `message`).

Click **Mark as Sent** after sending so the escalation ladder and the anti-nag cadence
(default: minimum 5 days between reminders per account, configurable) stay accurate.

**Promise to Pay:** record a promised date/amount on any account — it's held out of the
reminder queue until the promise date passes.

**Statements:** one click generates a clean, printable **Statement of Account**
(print → save as PDF) to attach to any reminder.

## Getting your data in

Fastest path: export an open-invoice report from your accounting software
(QuickBooks, Sage, Excel…) and import it in **Settings**:

- **Invoices CSV** — columns: `company, number, issueDate (YYYY-MM-DD), dueDate, amount, amountPaid`.
  Unknown companies are created automatically, so this one file is enough to get running.
- **Accounts CSV** — columns: `company, contactName, contactEmail, contactPhone, terms, notes`
  (run after/independently to fill in contact emails).

There's also **Load Demo Data** (Dashboard/Settings) to explore with sample delinquent
accounts, full **JSON backup/restore**, and CSV exports of accounts (with live balances)
and invoices.

## Notes & limits

- Data lives in the browser profile where you use it. Take a JSON backup regularly
  (Settings → Backup) — clearing browser data erases it.
- The login protects casual access on a shared machine; it is not server-grade security.
  Don't put the file on a public URL you care about without page-level protection.
- Late-fee/interest wording and the collections warning in L3/L4 are generic — make sure
  they match your actual terms and local regulations before sending.
