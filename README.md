# 97 LIVE — Finance Command

A private, single-page finance command center for **THE 97 World / NS Creative**.
Tracks client receivables, mobile-money credit lines, cash balances and monthly
budgets — with a built-in **AI copilot** and an always-on **smart suggestions**
engine. It runs entirely in the browser: no server, no database, no build step.

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
and AI features need an `http(s)://` origin.)

---

## 2. Install it on your phone
Open the hosted URL in your phone browser → **Add to Home Screen**. It installs
as a full-screen app with the 97 icon, and works **offline** (your data is on the
device). The AI copilot needs a connection; everything else works offline.

---

## 3. Turn on the AI copilot (optional)
The **Copilot** tab answers questions about your live numbers and gives advice.
It uses your own Anthropic API key:

1. Get a key at **console.anthropic.com** (add a little credit to the account).
2. In the app: **Settings → AI Assistant** → paste your key → it saves instantly.
3. Open **Copilot** and ask away — e.g. *"What should I chase first?"*,
   *"Can I afford to borrow 500K?"*, *"Am I on track this month?"*

**Privacy & cost**
- Your key is stored **only on your device** (browser local storage).
- Questions go **directly to Anthropic** and nowhere else — there is no middle
  server. A compact snapshot of your finances is sent as context so answers are
  accurate.
- You pay Anthropic per question (tiny — it defaults to a fast, cheap model).
  You can change the model in Settings if your account uses a different name.

The **Smart suggestions** on the dashboard and the "Right now" list in Copilot are
computed locally and need **no key**.

---

## 4. Your data & backups
- Everything you enter saves automatically to this browser on this device
  (per hosted address).
- **Settings → Backup & data** lets you **Export** a JSON backup and **Import**
  it on another device or browser.
- **Reset to sheet data** restores the original figures from your dashboard sheet.

---

## 5. Payment reminders (WhatsApp)
When something is **overdue or due within 7 days**, the dashboard shows a
**Payment reminders** card. Open it for a chase cockpit:

- Everyone late, sorted most-urgent first, each with a "days overdue" pill.
- **Templates** with slots (`{name} {amount} {date} {days} {project} {you}`) and
  three tones — **Friendly → Follow-up → Firm** — picked automatically by how
  late each payment is, or set by hand.
- **AI-personalise** (optional): uses your Anthropic key (the same one as the
  Copilot) to write each message individually in your voice, so no two are
  identical. Falls back to templates if the key is missing or offline.
- Add a **WhatsApp number** on each upcoming item (local `0772…` or full
  `+256772…`; the country code lives in **Templates → Country code**).

There are two ways to send:

**One-tap (works immediately, nothing to install).** Tap *Open next in WhatsApp*
— WhatsApp opens with the message pre-filled to that person, you press send, and
it advances to the next. Every send is a real tap by you, so your number is safe.

**Auto (hands-off).** Install the free **97 Sender** browser extension (below),
keep **web.whatsapp.com** open in a tab, and choose *Send automatically*. It
sends the whole queue for you at a **human pace** with safety rails:

- randomised gaps between messages (default 45–120s, with jitter)
- a **daily cap** and optional warm-up ramp
- batch breaks (e.g. pause after every 8)
- **quiet hours** (won't message late at night)
- auto-skips numbers WhatsApp reports as invalid/unsaved
- a **risk meter** showing today's count vs your cap

Tune all of these in the cockpit's **Safety** panel.

### Install 97 Sender (Chrome / Edge / Brave)
1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose the **`extension/`** folder from this repo.
4. Open **web.whatsapp.com** and link your phone (scan the QR) as usual.
5. Back in 97 LIVE, open **Payment reminders** — it now says *Sender connected*.

> The extension only sends the messages you queue, only while WhatsApp Web is
> open, and stores nothing off your machine. Automated sending on a personal
> number always carries some risk — the safety rails and human pacing are there
> to keep it looking natural, but keep volumes sensible.

---

## 6. What it does — and doesn't
It **tracks, forecasts, advises** and now **drafts and paces WhatsApp reminders**.
It does **not** move money or connect to your mobile-money or bank accounts. You
update balances and mark items paid; it does the maths, the alerts, the
suggestions, and helps you chase what's owed.

---

*Built for Zah · 97 LIVE.*
