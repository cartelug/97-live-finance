# 97 LIVE full UI direction

The redesign is a finance command centre: calm, fast to scan, and clear about
what is real money versus expected money.

## Above-the-fold hierarchy

1. Available cash and net position.
2. The three highest-value actions: add incoming, review receivables, open credit.
3. A compact glance row for this month and safe balances.
4. Needs attention and the next money event.

FX, earnings history, old repayments, settings and backup tools remain available
but do not compete with the first decision on the screen.

## Colour meaning

- Green: received money, paid work, healthy balances and primary actions.
- Teal: USD, available credit and potential money; never mixed with cash.
- Amber: due soon, pending and decisions that need attention.
- Coral: overdue, debt, outflow and risk.
- Violet: AI/Copilot only.

The palette is intentionally small so colour carries meaning instead of being
decoration.

## Deal model

The data and payment contract stays unchanged. One client deal remains one
parent record with its schedule underneath it.

- One payment: one total amount and one date.
- Split half-and-half: the entered contract total becomes two equal payments.
- Monthly retainer: the entered amount is per month.
- Per part: the entered amount is per part; the total is amount × number of parts.

Parts is the general label. Scenes, episodes, units, milestones and months are
optional labels. The schedule becomes financially locked after money is
recorded; contact, category and notes remain editable.

## Screen treatment

- Dashboard: one hero, one action rail, compact metrics, attention, next movement.
- Incoming: one card per deal, outstanding amount first, next part visible,
  full schedule inside Edit.
- Deal builder: progressive fields, live arithmetic explanation, date preview,
  and no unexplained “total amount” label for per-part values.
- Credit: Available, Borrowed and History as one switch; available credit is
  visually separate from cash and debt.

## Responsive behaviour

- Mobile is the primary layout: single-column cards, comfortable 44px controls,
  bottom navigation and a single floating add action.
- Desktop expands into a two-column command centre while wide summaries span the
  full content width.
- Repeated controls wrap instead of clipping. Focus states and reduced-motion
  behaviour remain available.

## Acceptance checks

- Existing local data, cloud sync, payments, receipts, reminders, balances and
  backups continue to use the same document shape.
- A three-part deal entered as USD 1,000 per part previews USD 3,000 total.
- Part 1 and the top first-due-date field always agree.
- A saved deal with recorded money cannot have its financial structure rewritten.
