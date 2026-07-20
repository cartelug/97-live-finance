# 97 Sender

Companion browser extension for **97 LIVE Finance**. It sends the WhatsApp
payment reminders you queue in the app through your own WhatsApp Web session, one
at a time, at a human pace with the safety rules you set in the app.

## Install (Chrome / Edge / Brave)
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Open **web.whatsapp.com** and link your phone.
4. In 97 LIVE open **Payment reminders** → it shows *Sender connected* → choose **Auto**.

## How it fits together
- `bridge.js` — injected on the 97 LIVE page. Relays `window.postMessage`
  (`x97-wa-app` ⇄ `x97-wa-ext`) to/from the background worker. Passive on all
  other sites.
- `background.js` — the orchestrator. Holds the queue in `chrome.storage.session`,
  paces sends with `chrome.alarms`, enforces daily cap / quiet hours / batch
  breaks / warm-up, and navigates the WhatsApp tab to each `…/send?phone=&text=`.
- `wa-content.js` — runs on web.whatsapp.com. Waits for the chat to open with the
  message prefilled, pauses a human moment, clicks **Send**, confirms, and reports
  back.
- `popup.html` / `popup.js` — live progress with pause / resume / stop.

## Maintenance
WhatsApp Web's DOM is undocumented and changes over time. If a WhatsApp redesign
breaks sending, adjust the `SELECTORS` block at the top of `wa-content.js`
(composer, send button, and the invalid-number dialog text) — that's the only
place tied to their markup.

## Privacy
Nothing leaves your machine. The extension only acts on messages the 97 LIVE page
sends it, and only sends while WhatsApp Web is open.
