# 97 LIVE final UI and product redesign

## V4 motion and interaction standard

The animation upgrade is a system, not a pile of effects. Every motion must
explain one of four things: **arrival, hierarchy, state change, or direct
response**. The production rules are:

- Animate compositor-friendly `transform` and `opacity` for entrances, exits,
  navigation selection, sheets, cards and button feedback.
- Use 160–220ms for direct feedback, 280–420ms for sheets and state changes,
  and up to 820ms only for the branded opening sequence.
- Use one expressive easing curve for arrival and a calmer ease for colour or
  opacity changes. Never animate layout dimensions during scrolling.
- Stagger only the first six meaningful page elements, then reveal the rest
  together so long finance lists never feel slow.
- The preloader places the 97 logo above “What’s on your mind today?”, then
  hands off to the app’s opening cascade after data is ready.
- Navigation, floating actions and scroll content share one safe-area geometry
  token so controls never cover deal cards on iPhone.
- All repeating pulses stop under `prefers-reduced-motion`; reduced-motion mode
  keeps state changes immediate and understandable.
- View transitions may enhance theme changes where supported, with an instant
  fallback everywhere else.
- Motion must never delay input, saving, or navigation, and must remain smooth
  on low-power mobile devices.

This standard applies to the preloader, page opening, navigation, totals,
deal-builder rows, live totals, sheets, buttons, cards and status indicators.

97 LIVE should feel like a calm private banking command centre built for a
working creative business. It must answer four questions immediately:

1. What money is available now?
2. What money is expected next?
3. What is overdue or risky?
4. What action should be taken today?

The interface should never mix cash already received with booked or available
money. Every number should have one meaning throughout the app.

## Product and information architecture

The finance model has four layers:

- **Deal** — the full contract, client, currency and value.
- **Schedule** — the promised payment names, amounts and due dates.
- **Payment ledger** — money actually received and where it was allocated.
- **Calculated position** — received, outstanding, progress, next due and
  overdue amounts.

The schedule is the source of truth for promised money. The payment ledger is
the source of truth for received money. Statuses and dashboard figures are
calculated from those two sources.

Primary mobile navigation should be:

1. **Home**
2. **Incoming**
3. **Expenses**
4. **Credit**
5. **More**

`More` contains Accounts, Earnings, Exports, Reminders, Converter, Copilot and
Settings. A persistent central add action opens a short action menu:

- Add deal
- Record payment
- Add expense
- Add account adjustment

## Visual system

### Typography

Use self-hosted Geist Sans for interface copy and IBM Plex Mono for every
financial number so the interface remains first-class, consistent and fully
available offline:

```css
font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

- Page titles: 30–38px, 760–800 weight, tight tracking.
- Hero money: 42–64px, 760–820 weight.
- Card values: 18–28px, 700–780 weight.
- Body: 13–15px, 450–550 weight.
- Labels: 10–11px, 700 weight, restrained uppercase tracking.
- Every financial number uses IBM Plex Mono with tabular, lining numerals.
- Audiowide remains only for the 97 brand mark; it is not used for money or UI.

### Colour semantics

- **Porcelain `#F2F2EC`** — page canvas.
- **White `#FFFFFF`** — primary cards and sheets.
- **Ink `#171B12`** — main text.
- **Deep green `#0E7548`** — received money, paid work and primary actions.
- **Teal `#0B7285`** — USD, available credit and potential money.
- **Amber `#855909`** — pending, due soon and attention.
- **Coral `#B5352E`** — overdue, debt, actual outflow and destructive actions.
- **Violet `#5D49D6`** — Copilot only.

Colour must communicate meaning, not decorate every card. A status always has
an icon or label as well as colour.

### Surfaces and motion

- 14–20px card radii; 24–28px sheets.
- Thin ink-tinted borders and soft shadows rather than heavy floating cards.
- One dominant card per section; avoid placing every line inside another card.
- Motion lasts 160–260ms and uses opacity/transform only.
- Large totals count or cross-fade only after data is ready.
- Respect reduced-motion settings.

## Dashboard — financial command centre

The dashboard should be deliberately short above the fold.

### 1. Compact top bar

- 97 LIVE mark and current month.
- Cloud state: Saved, Saving, Offline or Attention.
- Small profile/More button.
- No oversized page title competing with the money.

### 2. Cash-position hero

The largest number is **Available cash**, calculated only from actual account
balances. It must not contain receivables or credit.

The hero includes:

- Available cash.
- Net after active debt.
- Change this month: collected minus actual spending.
- A small account-count label.
- Tap to open Accounts.

USD holdings or receivables stay in a separate teal mini-row with the current
UGX equivalent; they are never silently mixed into cash.

### 3. Today action strip

Three high-value actions:

- **Record payment**
- **Add incoming deal**
- **Add expense**

Credit is not a top action unless a repayment is due. The app should prioritise
money already earned before borrowing.

### 4. Four-number snapshot

- Collected this month.
- Due in the next 7 days.
- Total outstanding.
- Actual spending this month.

Each card has one number, one short label and one useful comparison. Avoid
generic statistics with no action.

### 5. Needs attention

This is the first operational list:

- Overdue scheduled payments.
- Credit repayment due soon.
- Deals missing a due date or contact.
- Overspent personal/business budget.

Show a maximum of four rows, highest financial risk first. Each row opens the
exact item needing action.

### 6. Next money movement

A seven-day vertical timeline containing individual schedule items, planned
expenses and loan repayments. It should show:

- Date.
- Client/item.
- Direction.
- Amount.
- Paid/due/overdue state.

The timeline uses schedule rows, not the parent deal total.

### 7. Cash-flow pulse

A compact six-month collected-versus-spent chart appears below urgent items.
It is secondary evidence, not the hero. It uses received payments and actual
expenses only.

### 8. Lower dashboard modules

- Accounts preview: top three accounts and total.
- Recent activity: last five payments, expenses and reversals.
- Credit position: collapsed unless debt exists or repayment is near.
- Copilot suggestion: one short contextual insight, never a large chat panel.

Booked totals, exports, converter and settings do not belong above the fold.

## Incoming page

The page title is **Incoming** with a quiet subtitle: “Deals, payment schedules
and money still owed.”

### Summary row

- Total outstanding.
- Overdue amount.
- Due this month.
- Collected this month.

UGX and USD remain separate. A currency toggle can switch the summary rather
than displaying eight competing cards.

### Search and filters

- Search client, project, note or payment label.
- Quick chips: Needs action, Overdue, Next 7 days, This month, Paid.
- Advanced filters stay in a sheet.
- Sorting labels use plain language: Next due, Highest outstanding, Client.

### Deal card

Every card shows:

- Client/project.
- Outstanding amount as the primary figure.
- Deal total and received amount.
- Progress bar and percentage.
- Next unpaid schedule item: label, amount and due date.
- One primary action: Record payment.

The schedule is collapsed by default. Expanding shows paid, part-paid and
pending rows. Twelve scenes remain one deal card, not twelve unrelated cards.

## Deal details page

Opening a deal should use a dedicated detail sheet/page rather than placing all
editing fields immediately on screen.

Order:

1. Financial summary.
2. Next payment action.
3. Full payment schedule.
4. Payment history.
5. Invoice, receipt and WhatsApp actions.
6. Client/contact details.
7. Edit and cancellation controls.

Once money has been received, financial structure is read-only. Client,
contact, category and notes remain editable.

## Add/edit deal builder

Use a full-height mobile sheet with a sticky footer and visible progress:

1. Client
2. Structure
3. Amounts
4. Dates
5. Review

Structure choices are visual cards:

- One payment
- Deposit + balance
- Equal split
- Custom schedule
- Monthly retainer
- Per part

Only fields required by the chosen structure appear.

### Structure behaviour

- **One payment:** total and due date.
- **Deposit + balance:** total, deposit amount/percentage, deposit date and
  balance date. The balance calculates automatically.
- **Equal split:** total and two dates. Both amounts calculate automatically.
- **Custom schedule:** editable label, amount and date for every row, with Add
  payment and remaining-to-schedule indicators.
- **Monthly:** amount per month, number of months and first date.
- **Per part:** amount per part, number of parts, part label and first date.

The review step writes the arithmetic in a sentence:

`UGX 2,000,000 = UGX 700,000 deposit + UGX 1,300,000 balance`

Save stays disabled until totals and required dates are valid.

## Record payment sheet

The sheet opens with the next unpaid schedule item selected.

It shows:

- Deal outstanding.
- Apply to schedule item.
- Amount received.
- Date received.
- Destination account.
- Reference/note.
- Updated balance preview.

Partial payments visibly update the selected schedule row. A payment can be
distributed across multiple rows after confirmation. Payments above the full
outstanding amount are blocked with a clear explanation.

Undo becomes a financial reversal with a reason; the original payment remains
visible in history.

## Expenses page

Use two top tabs: **Planned** and **Actual**.

- Hero: actual spend this month.
- Personal and business budget progress below.
- Upcoming planned expenses ordered by date.
- Recent actual expenses ordered by date.
- One floating Add expense action.

Do not show budget setup fields on the main page. Put them in Edit budgets.
Planned expenses use amber; actual expenses use coral.

## Accounts page

- Total available cash at the top.
- One compact card per bank, mobile money or cash account.
- Each card shows balance, identifier and last movement.
- Account detail shows a transaction timeline.
- Manual balance correction is an explicit adjustment with a note, not a
  silent replacement.

## Credit page

Use three tabs: **Active**, **Available** and **History**.

- Active debt is the default whenever money is borrowed.
- Hero: amount due today and next repayment date.
- Available credit is visually secondary and teal; it is never presented as
  owned cash.
- Each loan shows principal, fees, amount due, due date and repayment account.
- Repayment supports partial payments and a proper history.

Credit provider setup stays behind Add facility/Edit facility.

## Earnings and Books

### Earnings

- Collected this month.
- Six-month collected-versus-spent chart.
- Payment ledger with client, date, account and currency.
- Filters for month, client, currency and account.

### Books/Exports

Separate exports:

- Deals.
- Payment schedules.
- Payments received.
- Outstanding receivables.
- Expenses.

Each export explains what it contains before download.

## Reminders and Messaging

The default view is a queue of scheduled payments that need chasing.

- Group by Overdue, Due today and Due soon.
- Show the specific payment label, amount and due date.
- One client receives one clear message even when several rows are overdue.
- Templates remain editable under settings.
- Campaign tools stay separate from payment reminders.

## Converter

The converter remains a focused utility sheet:

- Large From and To values.
- Swap action between them.
- Rate, source and update time.
- Saved common pairs.

It should not appear as a major dashboard module.

## Copilot

- Keep violet as its exclusive colour.
- Start with suggested questions based on current risks.
- Show the financial data date/time used for each answer.
- Copilot may explain and recommend, but it never records or deletes money
  without a separate confirmed action.

## Settings and backup

Group settings into:

- Business identity.
- Currency and rates.
- Categories and labels.
- Budgets.
- Reminders.
- Cloud and devices.
- Backup and restore.

Dangerous actions such as restore or reset require a preview and explicit
confirmation. Backup status and latest cloud save remain visible.

## Responsive behaviour

### Mobile

- Single column.
- 44–52px controls.
- Sticky bottom navigation and sticky sheet actions.
- Bottom padding prevents save buttons covering content.
- Dense schedules collapse intelligently.
- Keyboard opening must not hide amount or save controls.

### Desktop

- Maximum content width around 1120px.
- Dashboard uses a 7/5 two-column grid.
- Summary and timeline can span the full width.
- Sheets become centred dialogs with fixed maximum widths.
- Hover states supplement but never replace visible actions.

## What should not be shown by default

- Full twelve-row schedules.
- Export and backup controls.
- Credit offers when debt needs attention.
- Manual payment status.
- Every filter at once.
- Repeated totals with different meanings.
- Technical sync versions.
- AI/API configuration.
- Long explanatory paragraphs inside operational screens.

## Final acceptance checks

- Available cash contains only real account balances.
- This-month and seven-day totals are calculated from individual schedule rows.
- UGX 2,000,000 can be scheduled as UGX 700,000 deposit plus UGX 1,300,000
  balance.
- UGX 700,000 × 12 scenes produces one UGX 8,400,000 deal.
- Recording UGX 350,000 against a UGX 700,000 deposit shows that deposit as
  partially paid.
- Reminders, invoice text, receipts, exports and dashboard figures agree.
- Existing records, cloud sync, backups, balances, expenses, credit and
  converter continue working.
- Mobile layouts work at 320px width without clipped amounts or covered actions.
- The previous production version remains recoverable until final approval.
