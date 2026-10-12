# Loanie's Debt — Personal App Plan

## 1. Goal

A private, phone-first record book for one lender. It records borrowers, loans, releases, payments, balances, guarantor rewards, and loan history. The lender can use it comfortably on a phone and still access the same records on a larger screen.

The first release should make these tasks reliable:

1. Find or add a borrower.
2. Create a loan and confirm when cash was actually released.
3. Record a payment in a few taps and see the new balance immediately.
4. Find loans that are due, overdue, or paid.
5. Review a borrower’s complete history without replacing old records.

This is a personal record-keeping tool, not a multi-lender service. Keep the first version focused on one owner and one currency, Philippine pesos (₱).

## 2. Defaults and loan terms

Use these as defaults for a new loan:

- Principal: ₱10,000
- Total due: ₱12,000 (principal + 20%, calculated automatically)
- Term: 40 calendar days
- Added charge: 20% of principal

The lender must be able to change the principal, start date, and term for each loan. Calculate total due as `principal × 1.20`; total due and the added charge are read-only. Store currency as integer centavos (for example, ₱12,000.50 as 1,200,050 centavos) to avoid rounding errors.

When a start date and term are entered, suggest a due date. Let the lender review it before saving. Store currency as integer centavos (for example, ₱12,000.50 as 1,200,050 centavos) to avoid rounding errors.

## 3. Main screens and phone navigation

Use a compact bottom navigation bar on phones with four destinations:

- **Home** — collection summary, due soon, overdue, and recent activity.
- **Loans** — active, pending release, paid, and voided loans with search and filters.
- **Borrowers** — searchable borrower list and profiles.
- **More** — guarantor rewards, reports, backup, and settings.

Keep a prominent **Record payment** action on Home and on each active loan. Put secondary actions such as export and settings in More, not in the primary navigation.

On narrow screens:

- Show records as readable cards instead of wide tables.
- Keep the main action reachable near the bottom of the screen.
- Use labeled fields, numeric keyboards for money and phone numbers, and large tap targets (at least 44 × 44 CSS pixels).
- Avoid horizontal scrolling for normal tasks. Make long histories scroll vertically and keep filters easy to open and clear.
- Support phone portrait and landscape layouts, browser zoom, and screen readers; never convey status by color alone.

On larger screens, the same content may use wider rows and a two-column dashboard. No feature should exist only on desktop.

## 4. Core records

### Borrower

- Generated borrower ID
- Full name (required)
- Phone number (optional)
- Address or area (optional)
- Notes (optional)
- Optional signature image, with the borrower’s consent
- Created and last-updated dates

Search by name, phone number, or borrower ID. Warn about a likely duplicate before creating a second borrower; allow the lender to proceed if they confirm it is a different person.

### Loan

- Generated loan ID and borrower ID
- Optional guarantor/referral record
- Principal and total due
- Start date and due date
- Release amount and release date, once released
- State: Pending release, Active, Fully paid, or Voided
- Optional notes
- Link to the prior loan when this loan is a renewal
- Created date and any void reason

Do not store a manually editable remaining balance. Calculate it from the loan’s total due and its valid payment entries.

### Payment

- Generated payment ID and loan ID
- Amount and date received
- Optional note or receipt reference
- Creation date
- If corrected: reversal/correction link and reason

Keep every payment event in the ledger. To fix a mistake, reverse the original entry with a reason and add the corrected payment. Do not silently edit or delete a payment that has already affected a balance.

### Guarantor reward

- Guarantor name and optional contact details
- Referred borrower and qualifying loan
- Reward amount (default ₱500)
- State: Pending or Paid
- Paid date and optional note

Create at most one reward per qualifying loan. Marking it paid must be a single action that records the date and prevents a second payout for that loan.

## 5. Loan and payment rules

- A new loan starts as **Pending release**. It does not count as an active balance until the lender confirms the cash was handed over.
- Confirmation records the amount actually released and the release date. If the release amount differs from principal, show the difference for review and require a note before confirming.
- Payments can be recorded only against an active loan. Require an amount greater than zero and a received date.
- Reject a payment larger than the current remaining balance. A payment equal to the balance closes the loan.
- Remaining balance = total due − valid payments. Never let a user type over this value.
- When remaining balance reaches zero, set the loan to **Fully paid** and record the paid date. A paid loan cannot accept another payment.
- A loan is **Overdue** when it is active, has a positive balance, and its due date is before today. A loan is **Due soon** when it is active and its due date is within the next 7 days. These are display labels derived from dates and balance, not separate editable states.
- A voided loan must have a reason. A loan with a released amount or payments cannot be voided through the ordinary flow; require the lender to resolve or reverse its financial entries first.
- A renewal always creates a new loan linked to the prior loan. It never changes the previous loan or its payment history.
- Use the lender’s local calendar date for due-date and “today” views. Save timestamps consistently and display them in the lender’s local time zone.

## 6. Main workflows

### Create and release a loan

1. Find an existing borrower or add one.
2. Enter principal, total due, start date, and term; review the suggested due date.
3. Add a guarantor if there is one and preview the reward record.
4. Save as Pending release.
5. When money is handed over, open the loan, confirm the amount and date, and activate it.

### Record a payment

1. Open **Record payment** from Home, a borrower profile, or an active loan.
2. Select the loan if the borrower has more than one active loan.
3. Enter amount and date; show the current balance and projected balance before saving.
4. Save once, show a clear success state, and offer a simple receipt/entry summary.

Prevent accidental duplicate submissions if the save button is tapped twice or the connection is slow. If saving fails, keep the entered values on screen and explain how to retry.

### Renew a borrower

Offer **New loan for this borrower** from their profile or completed loan. Prefill the last-used terms for convenience, but require review and create a new loan ID. Link the new loan to the previous one.

## 7. Home and useful lists

Home should prioritize actions and exceptions over totals. Show:

- Today’s collected amount and number of payments
- Active loan count and total outstanding balance
- Due soon and overdue counts, each opening its filtered list
- Recent payments with borrower, amount, and date
- A clear action to record a payment

Loan lists need search and simple filters for borrower, state, due date, and area. Borrower profiles should show contact details, all loans, total outstanding amount, payment history by loan, and renewal links. A payment must always be associated with one specific loan so histories and balances remain understandable.

## 8. Privacy, reliability, and recovery

The records include personal and financial information. Require a private owner account or device-protected access, provide a way to lock the app, and avoid exposing full borrower details in notifications or unprotected exports. Store signature images with the borrower record and include them only in an export or printout when needed.

Every write should either save completely or leave the previous data intact. Show clear errors and avoid duplicate loan, payment, or reward creation after retries. If offline use is supported, show whether a change is saved on the device or synced; do not report success until the record is safely stored.

Provide a manual backup and restore flow before treating the app as the only record book. Backups should include all records and links, carry a creation date, and be protected because they contain sensitive data. Before restoring, show which data will be replaced and require an explicit confirmation. Make it possible to export a readable CSV of borrowers, loans, payments, and rewards for recovery or bookkeeping.

## 9. MVP scope

Build these first:

1. Owner-only access and lock behavior.
2. Borrower creation, search, and profile.
3. Loan creation, pending release, and release confirmation.
4. Payment entry, balance calculation, full payment, and correction by reversal.
5. Home, active/due/overdue/paid lists, and borrower/loan history.
6. New loan renewal linked to the prior loan.
7. Guarantor reward tracking with duplicate-payout protection.
8. Manual backup, restore, and CSV export.
9. Responsive phone layouts and accessible form controls.

Defer PDF packs, charts, automated reminders, multi-user access, cloud sync, and complex accounting reports until the lender has used the MVP and identified a real need.

## 10. Acceptance checks

The first release is ready when the lender can verify these on a phone:

- Create a borrower and find them again by name or ID.
- Create a ₱10,000 principal / ₱12,000 total loan with a 40-day term, review the suggested due date, and leave it pending until cash is released.
- Confirm release and see the loan appear in active loans.
- Record ₱300, then see the remaining balance change from ₱12,000 to ₱11,700 in the loan and borrower history.
- Reject zero, negative, and over-balance payments with a clear message.
- Reverse a mistaken payment with a required reason and retain both the original and correction in history.
- Mark a loan fully paid automatically after its final valid payment, then prevent another payment.
- See active unpaid loans become due soon and overdue based on the lender’s local date.
- Renew a paid loan and confirm the old loan and its ledger are unchanged.
- Pay a guarantor reward once and confirm the same loan cannot generate a duplicate paid reward.
- Complete the main tasks without horizontal scrolling at a common phone width, with visible labels and reachable actions.
- Create a backup, restore it into a clean app state, and verify that borrower, loan, payment, and reward links still match.

## 11. Suggested data relationships

- One borrower has many loans.
- One loan has many payment ledger entries and at most one guarantor reward.
- A loan may link to one prior loan for renewal history.
- A guarantor/referral can be associated with one or more borrowers or qualifying loans.
- Reversals point to the payment they reverse; audit entries record who changed a financial record, when, and why.

Keep IDs stable and preserve historical records. Do not permanently delete released loans, payments, reversals, or paid rewards through normal app use.
