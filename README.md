# 97 LIVE V2 — Finance Command Centre

A private, single-page finance command center for **THE 97 World / NS Creative**.
Tracks client receivables, mobile-money credit lines, cash balances and monthly
budgets with a focused **financial signals** engine. It runs entirely in the
browser: no application server, no database migration, and no bundled AI service.

## Experience V2 — premium finance command

The current interface keeps the original React app and `ns97-finance-v1` data
contract, then adds a mobile-safe finance-intelligence layer on top:

- self-hosted **Geist Sans** tabular money figures with **Geist Mono** reserved
  for compact system labels, giving totals a cleaner, less cramped rhythm
- a premium neutral-charcoal visual system with emerald, cyan and coral reserved
  for meaning, plus adaptive light/dark surfaces and accessible contrast
- richer page, card, number, progress, sheet, button and status motion using
  compositor-friendly effects, with full reduced-motion support
- touch-first finance pulse, account and incoming-month sliders with scroll snap
  and accessible position controls on phones
- phone-first responsive layouts: 16px editable controls, 46–48px targets,
  readable long currency amounts and stacked dense grids on narrow phones
- safe-area and dynamic-viewport sheet sizing, keyboard-aware focused fields,
  protected sheet scrolling, and shared bottom-navigation spacing
- pinch zoom is available again; horizontal overflow is fixed at its source
  instead of being hidden
- campaign CSV paste no longer rebuilds the panel and loses focus per character
- cache versions move together so an updated phone cannot load a mixed interface
- a simplified **Incoming** cockpit with Open, Needs action, Due in 7 days, Paid
  and Everything views
- compact deal cards with direct **Record payment**, **WhatsApp** and **Details**
  actions
- corrected outstanding, overdue, due-soon and monthly-collected calculations,
  including reversed-payment exclusion and separate UGX/USD totals

### Incoming schedules

Incoming work stays as one deal with a visible payment schedule. Choose **One
payment**, **Deposit + balance**, **Equal split**, **Custom schedule**, **Monthly
retainer**, or **Per part**. A custom schedule lets you enter unequal amounts —
for example UGX 2,000,000 as a UGX 700,000 deposit followed by a UGX 1,300,000
balance. Payments are recorded against the schedule, so the dashboard separates
cash actually received from money still promised.

---

## 1. Host it (pick one)

### GitHub Pages
1. Create a new repository and upload **all of these files** (keep the folder
   structure — `index.html` must sit at the top level, with `icons/` beside it).
2. Repo → **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**,
   pick your branch (e.g. `main`) and the `/ (root)` folder, then **Save**.
4. Wait ~1 minute. Your app is live at
   `https://<your-username>.github.io/<your-repo>/`.

> The included `.nojekyll` file tells Pages to serve everything as-is.

### Netlify (drag & drop, fastest)
Go to app.netlify.com → **Add new site → Deploy manually** → drag this whole
folder onto the page. Done.

### Test locally first (optional)
From inside this folder:
```
python3 -m http.server 8080
```
Then open `http://localhost:8080`.
(Open it through a server, not by double-clicking the file — the service worker
and offline features need an `http(s)://` origin.)

---

## 2. Install it on your phone
Open the hosted URL in your phone browser → **Add to Home Screen**. It installs
as a full-screen app with the 97 icon, and works **offline** (your data is on the
device). Cloud sync and live rates need a connection; the finance workspace does not.

---

## 3. Financial signals
The dashboard's **Financial signals** are computed locally from due dates,
outstanding amounts, balances, budgets and credit. They require no API key and
do not transmit a finance snapshot to an assistant service. V2 removes the
Copilot tab, its Settings panel and its active network path.

---

## 4. Your data & backups
- Everything you enter saves automatically to this browser on this device
  (per hosted address).
- **Settings → Backup & data** lets you **Export** a JSON backup and **Import**
  it on another device or browser.
- **Reset to sheet data** restores the original figures from your dashboard sheet.

---

## 5. Messaging (WhatsApp reminders & bulk campaigns)
One **Messaging** card on the dashboard opens a single hub for everything
WhatsApp — chasing overdue clients and sending bulk campaigns share the same
engine, contacts and safety rails, so they live in one place:

- **Chase overdue** — everyone late, sorted most-urgent first, each with a
  "days overdue" pill. **Templates** with slots
  (`{name} {amount} {date} {days} {project} {you}`) and three tones —
  **Friendly → Follow-up → Firm** — picked automatically by how late each
  payment is, or set by hand. Drafts use editable local templates.
- **New campaign** — a full message editor: a formatting toolbar (**bold**,
  *italic*, ~~strike~~, monospace), an emoji picker, an **@value** menu for
  **merge variables** (`{{name}}`, `{{company}}`, or any imported column),
  **spintax** — `{Hi|Hello|Hey}` picks one at random per person so no two
  texts are identical — and a **Format test** preview per recipient.
- **Contacts & lists** — **import contacts** by pasting a CSV or choosing a
  file, or **Connect Google Contacts** to pull your real phone contacts in
  directly (see below). Either way it auto-detects/normalises names & phone
  numbers, de-duplicates, and saves them as a named list. Send to any list,
  **all contacts**, the built-in **Overdue clients** smart list, or type
  numbers in by hand.
- **Templates** — save any message as a reusable template and load it into a
  new campaign or reminder in one tap.

Add a **WhatsApp number** on each upcoming item (local `0772…` or full
`+256772…`; the country code lives in **Templates → Country code**) — or let
**contact matching** do it for you:

### Contact matching
Once you've imported contacts (CSV or Google), open **Numbers** (from Chase
overdue) or **Match against overdue clients** (from Contacts & lists). It
fuzzy-matches each finance client's name against your imported contacts:

- **Confident match** (e.g. "Apollo Studios — Scene 3" ↔ contact "Apollo
  Studios") → the number is **filled in automatically** — just review and Save.
- **Ambiguous match** (e.g. "John" could be "John Doe" or "John Smith") →
  **you're asked to pick** from the candidates, or type the number yourself.
- **No match found** → a plain number field, same as before.

Nothing is guessed silently — only sure matches get filled in for you; the app
puts the rest in front of you to decide.

The same matching also happens **live while you're adding or editing an
upcoming payment**: the WhatsApp number field sits right under the client
name, showing the best textual match up front. There's also a **search box**
right below it — type *any* name, nickname, or part of a number (e.g. "Isaac's
neighbor", "Tata", a surname) to search **every** imported contact, not just
ones that look similar to the client's name. This covers the informal labels
people actually save contacts under. The **Numbers** screen works the same way,
per client.

The search is forgiving on purpose: it matches your words in **any order**
(so it never fails just because a name has extra words in between), tolerates
a small typo like two swapped letters, and if a query matches more contacts
than fit on screen it tells you — *"Showing 20 of 34 — add a surname to
narrow it down"* — instead of silently leaving the one you want off the list.

The **Add/Edit upcoming** form is also progressive: only Client name, WhatsApp
number, and Amount show at first — Category, Status, Expected date, and Note
collapse under **"More details"** (one tap to expand; automatically expanded
when editing an existing item, so nothing looks hidden).

There are two ways to send — same for reminders and campaigns:

**One-tap (works immediately, nothing to install).** Opens WhatsApp with the
message pre-filled to that person, you press send, and it advances to the
next. Every send is a real tap by you, so your number is safe.

**Auto (hands-off).** Install the free **97 Sender** browser extension (below),
keep **web.whatsapp.com** open in a tab, and choose *Auto*. It sends the whole
queue for you at a **human pace** with safety rails — **Antiblock** presets
(**Conservative / Balanced / Fast**) plus:

- randomised gaps between messages, with jitter
- a **daily cap** and optional warm-up ramp
- batch breaks (e.g. pause after every 8)
- **quiet hours** (won't message late at night)
- auto-skips numbers WhatsApp reports as invalid/unsaved
- a **risk meter** on the hub showing today's count vs your cap

Every campaign gets a **report** — per-recipient sent / failed / skipped,
campaign history on the hub, and **Export CSV**.

### Connect Google Contacts (optional)
Messaging → **Contacts & lists** → **Connect Google Contacts** pulls the names
and phone numbers from your real Google/Android contacts straight into a list,
so you don't have to build a CSV by hand.

This needs a free, one-time **Google API Client ID** for your own copy of the app.
Nothing is shared with anyone else; the request goes **directly from your
browser to Google**, there is no middle server, and only a name + phone number
is read (read-only access — nothing can be changed or deleted in your Google
account).

**One-time setup (~3 minutes):**
1. Go to **console.cloud.google.com** and create a project (or use an existing one).
2. **APIs & Services → Library** → search **"Google People API"** → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** → fill in
   the app name and your email → under **Test users**, add your own Google
   account email (this keeps it private to you, no Google review needed).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   Application type **Web application** → under **Authorized JavaScript
   origins** add `https://<your-username>.github.io` (your hosted URL, no
   path, no trailing slash) → **Create**.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and paste it
   into the **Connect Google Contacts** prompt in the app.

After that, click **Connect Google Contacts** any time to sign in with Google
and pull in your contacts — re-run it later to sync new ones.

### Install 97 Sender (Chrome / Edge / Brave)
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose the **`extension/`** folder from this repo.
4. Open **web.whatsapp.com** and link your phone (scan the QR) as usual.
5. Back in 97 LIVE, open **Messaging** — the hub now says *Sender connected*.

> The extension only sends the messages you queue, only while WhatsApp Web is
> open, and stores nothing off your machine. Automated sending on a personal
> number always carries some risk — the safety rails and human pacing are there
> to keep it looking natural, but keep volumes sensible.

### Polish
The Messaging screens carry the **97 mark** in their headers, empty states, and
message previews, animate in the same style as the rest of the app (with full
`prefers-reduced-motion` support), and have been checked at narrow phone widths
— dropdown menus dock safely on small screens instead of clipping off-edge.

---

## 6. Live currency converter
The dashboard carries a **Currency** card showing what 1 USD buys in shillings
right now, plus EUR, GBP, KES and TZS at a glance. Tap it for the full
**converter**: type an amount, pick any two of ~160 currencies, swap with one
tap, and see the result update as you type — along with the rate both ways.

**Rates refresh themselves once a day.** The app checks on open, when the
device comes back online, and on a timer, so a phone left running overnight
still wakes up on the new day's rate. Nothing to press.

- **No key, no setup, no server.** Rates come straight from your browser to a
  free public rate service ([ExchangeRate-API's open
  endpoint](https://www.exchangerate-api.com/docs/free)), with
  [Currency-API](https://github.com/fawazahmed0/exchange-api) as a standby if
  it's unreachable. Nothing about your finances is sent — the request only asks
  "what are today's rates".
- **Works offline.** The last good rate table is saved on the device, so the
  converter keeps working with no connection; the card just says *Last known*
  instead of *Live*.
- **Your USD rate stays in step.** The daily rate updates the **USD rate** in
  Settings, so the dashboard's *This month USD* tile shows its shilling value
  and every finance calculation uses today's number instead of a stale one.
- **Prefer your own rate?** Tick **Keep my own USD rate** in the converter and
  auto-update pauses — the figure you typed in Settings is left alone. The
  converter still shows live rates.

A bad or empty response from the rate service is discarded rather than saved,
so a provider having a bad day can never overwrite a good rate with a broken one.

---

## 7. Payments, part payments & earnings
Marking something **Paid** now records an actual payment instead of just
flipping a label. Tap **Paid** (or **Record payment**) on any upcoming item and
you get: how much came in, the date, and which account it landed in.

- **Part payments are real.** Enter less than the full amount and the rest
  stays outstanding — the dashboard, the overdue count and the WhatsApp chase
  message all quote **what's still owed**, not the original invoice. The card
  shows a progress bar: *UGX 4,000,000 in — of UGX 10,000,000*.
- **Money lands somewhere.** Pick an account and its balance goes up by the
  amount received. Dollar payments are converted at the day's live rate first
  (see the converter above), so shilling balances stay honest.
- **Nothing is one-way.** Every payment is listed on the item with an **Undo**
  that reverses both the ledger entry and the account credit.
- **Earnings history.** The dashboard carries an **Earnings** card — received
  this month, spent, kept, and a six-month bar chart of in vs out. **History**
  opens the full month-by-month table and every payment received.

The invoice total lives on the record too, so editing an item edits what the
job was worth and the outstanding figure follows from it.

> Under the hood the item's `amount` field keeps meaning *what is still owed*,
> which is what every existing finance screen already assumed — so
> they all became correct the moment part payments arrived, with no changes.

---

## 8. Structured deals and parts

Incoming work is stored as one deal with its payment schedule underneath it,
instead of forcing you to create one unrelated row for every scene, episode,
unit or milestone. The supported structures are:

- **One payment** — one amount and one due date.
- **Deposit + balance** — enter the full total and the deposit; the balance is
  calculated automatically.
- **Split — half and half** — two correctly dated payments.
- **Custom schedule** — enter each label, amount and due date; the rows must
  add up to the full deal total.
- **Monthly retainer** — one amount per month for a chosen number of months.
- **Per part** — the amount you enter is for each scene, episode, unit or
  milestone; the deal total is that amount multiplied by the number of parts.

The deal screen previews the full schedule before saving. Each part can have its
own due date, and the schedule becomes read-only after money is recorded so the
financial history cannot be accidentally rewritten. A deal card shows the
total, the per-part amount, how many parts are paid, the next part due and what
is still uncollected.

For example, **UGX 700,000 × 12 scenes** becomes one Apollo Studios card worth
**UGX 8,400,000**. After three scene payments, it shows **3 of 12 paid**,
**UGX 2,100,000 received** and **UGX 6,300,000 uncollected**. A **$1,000
half-and-half** contract becomes two **$500** payments with separate dates.
For a three-part deal, entering **$1,000 per part** therefore creates a
**$3,000** deal with three **$1,000** scheduled payments.

## 9. Exports & documents
**Earnings → Export** writes spreadsheet files your accountant can open
directly — no formatting to unpick:

- **Receivables** — invoice total, received, outstanding, status, dates.
- **Payments received** — every payment, with the UGX value of dollar receipts.
- **Expenses** — planned and actual.

Files are UTF-8 with a BOM so Excel gets shillings and accented client names
right, and any cell that starts with `=`, `+`, `-` or `@` is written as text so
a spreadsheet can't treat imported data as a formula.

**Invoices and receipts** come off any upcoming item (**Edit → Invoice** /
**Receipt**). They're formatted WhatsApp text rather than a file to download —
the client reads it straight in the chat. Numbering is automatic (`INV-2026-004`),
receipts list every payment received, and **Send on WhatsApp** opens the chat
with it filled in. Set your business name once and it's reused on every document.

---

## 10. What it does — and doesn't
It **tracks, forecasts, advises**, **records what you actually get paid**,
**converts currencies at live daily rates**, **exports your books** and
**drafts and paces WhatsApp reminders**.
It does **not** move money or connect to your mobile-money or bank accounts. You
update balances and mark items paid; it does the maths, the alerts, the
suggestions, and helps you chase what's owed.

---

*Built for Zah · 97 LIVE.*
