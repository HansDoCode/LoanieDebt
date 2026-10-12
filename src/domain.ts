import type {
  AppData,
  AppSettings,
  AuditEntry,
  Borrower,
  Loan,
  Payment,
  Reward,
} from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  defaultPrincipalCentavos: 1_000_000,
  defaultTotalDueCentavos: 1_200_000,
  defaultTermDays: 40,
  defaultRewardCentavos: 50_000,
};

export const emptyData = (): AppData => ({
  schemaVersion: 1,
  settings: { ...DEFAULT_SETTINGS },
  borrowers: [],
  loans: [],
  payments: [],
  rewards: [],
  audit: [],
});

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayLocal(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function daysBetweenLocal(startDate: string, endDate = todayLocal()): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function addDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDate(dateIso?: string): string {
  if (!dateIso) return "—";
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
    new Date(`${dateIso}T12:00:00`),
  );
}

export function formatMoney(centavos: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: centavos % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100);
}

export function moneyInputValue(centavos: number): string {
  return centavos % 100 === 0 ? String(centavos / 100) : (centavos / 100).toFixed(2);
}

export function parseMoney(value: string): number {
  const normalized = value.trim().replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid peso amount with up to two decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const centavos = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos)) throw new Error("That amount is too large.");
  return centavos;
}

export function borrowerName(data: AppData, borrowerId: string): string {
  return data.borrowers.find((borrower) => borrower.id === borrowerId)?.fullName ?? "Unknown borrower";
}

export interface LoanDayStats {
  daysPassed: number;
  noPaymentDays: number;
  lastPaymentDate?: string;
}

export function getLoanDayStats(data: AppData, loan: Loan, date = todayLocal()): LoanDayStats {
  const lastPaymentDate = getLoanPayments(data, loan.id)
    .filter((payment) => payment.kind === "payment" && !isPaymentReversed(data, payment.id))
    .map((payment) => payment.receivedDate)
    .sort()
    .at(-1);
  const paymentStart = lastPaymentDate ?? loan.releaseDate ?? loan.startDate;
  return {
    daysPassed: daysBetweenLocal(loan.releaseDate ?? loan.startDate, date),
    noPaymentDays: daysBetweenLocal(paymentStart, date),
    lastPaymentDate,
  };
}

export function getLoan(data: AppData, loanId: string): Loan {
  const loan = data.loans.find((item) => item.id === loanId);
  if (!loan) throw new Error("Loan not found.");
  return loan;
}

export function getLoanPayments(data: AppData, loanId: string): Payment[] {
  return data.payments
    .filter((payment) => payment.loanId === loanId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isPaymentReversed(data: AppData, paymentId: string): boolean {
  return data.payments.some((payment) => payment.reversalOf === paymentId);
}

export function getLoanBalance(data: AppData, loanId: string): number {
  const loan = getLoan(data, loanId);
  const ledgerTotal = data.payments
    .filter((payment) => payment.loanId === loanId)
    .reduce((total, payment) => total + payment.amountCentavos, 0);
  return Math.max(0, loan.totalDueCentavos - ledgerTotal);
}

export type LoanDisplayStatus = Loan["state"] | "due_soon" | "overdue";

export function loanDisplayStatus(
  data: AppData,
  loan: Loan,
  date = todayLocal(),
): LoanDisplayStatus {
  if (loan.state === "voided" || loan.state === "pending_release") return loan.state;
  const balance = getLoanBalance(data, loan.id);
  if (balance === 0 || loan.state === "paid") return "paid";
  if (loan.dueDate < date) return "overdue";
  if (loan.dueDate <= addDays(date, 7)) return "due_soon";
  return "active";
}

export function likelyDuplicateBorrowers(
  data: AppData,
  fullName: string,
  phone: string,
  exceptId?: string,
): Borrower[] {
  const name = fullName.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, "");
  return data.borrowers.filter((borrower) => {
    if (borrower.id === exceptId || borrower.deletedAt) return false;
    const sameName = name.length > 2 && borrower.fullName.trim().toLowerCase() === name;
    const borrowerPhone = borrower.phone.replace(/\D/g, "");
    const samePhone = normalizedPhone.length > 5 && borrowerPhone === normalizedPhone;
    return sameName || samePhone;
  });
}

function audit(
  data: AppData,
  entityType: AuditEntry["entityType"],
  entityId: string,
  action: string,
  reason?: string,
): AppData {
  return {
    ...data,
    audit: [
      ...data.audit,
      { id: makeId(), entityType, entityId, action, reason, createdAt: nowIso() },
    ],
  };
}

export function addBorrower(
  data: AppData,
  input: Pick<Borrower, "fullName" | "phone" | "area" | "notes">,
): AppData {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Full name is required.");
  const createdAt = nowIso();
  const borrower: Borrower = {
    id: makeId(),
    fullName,
    phone: input.phone.trim(),
    area: input.area.trim(),
    notes: input.notes.trim(),
    createdAt,
    updatedAt: createdAt,
  };
  return audit({ ...data, borrowers: [...data.borrowers, borrower] }, "borrower", borrower.id, "created");
}

export function updateBorrower(
  data: AppData,
  borrowerId: string,
  input: Pick<Borrower, "fullName" | "phone" | "area" | "notes">,
): AppData {
  const fullName = input.fullName.trim();
  if (!fullName) throw new Error("Full name is required.");
  if (!data.borrowers.some((borrower) => borrower.id === borrowerId && !borrower.deletedAt)) throw new Error("Borrower not found.");
  const borrowers = data.borrowers.map((borrower) =>
    borrower.id === borrowerId
      ? { ...borrower, fullName, phone: input.phone.trim(), area: input.area.trim(), notes: input.notes.trim(), updatedAt: nowIso() }
      : borrower,
  );
  return audit({ ...data, borrowers }, "borrower", borrowerId, "updated");
}

export interface LoanInput {
  borrowerId: string;
  principalCentavos: number;
  totalDueCentavos: number;
  startDate: string;
  dueDate: string;
  termDays: number;
  notes: string;
  guarantorName: string;
  guarantorPhone: string;
  rewardCentavos?: number;
  priorLoanId?: string;
  signatureImageDataUrl: string;
}

export function createLoan(data: AppData, input: LoanInput): { data: AppData; loan: Loan } {
  if (!data.borrowers.some((borrower) => borrower.id === input.borrowerId && !borrower.deletedAt)) throw new Error("Select a borrower.");
  if (!Number.isSafeInteger(input.principalCentavos) || input.principalCentavos <= 0) throw new Error("Principal must be greater than zero.");
  if (!Number.isSafeInteger(input.totalDueCentavos) || input.totalDueCentavos < input.principalCentavos) throw new Error("Total due must be at least the principal.");
  if (!input.startDate || !input.dueDate) throw new Error("Start and due dates are required.");
  if (!Number.isInteger(input.termDays) || input.termDays <= 0) throw new Error("Term must be a positive number of days.");
  if (!input.signatureImageDataUrl?.trim()) throw new Error("A signature photo is required for every loan.");
  if (input.guarantorName.trim() && (!Number.isSafeInteger(input.rewardCentavos ?? data.settings.defaultRewardCentavos) || (input.rewardCentavos ?? data.settings.defaultRewardCentavos) <= 0)) throw new Error("Reward must be greater than zero.");
  const createdAt = nowIso();
  const loan: Loan = {
    id: makeId(),
    borrowerId: input.borrowerId,
    priorLoanId: input.priorLoanId,
    principalCentavos: input.principalCentavos,
    totalDueCentavos: input.totalDueCentavos,
    startDate: input.startDate,
    dueDate: input.dueDate,
    termDays: input.termDays,
    state: "pending_release",
    notes: input.notes.trim(),
    guarantorName: input.guarantorName.trim() || undefined,
    guarantorPhone: input.guarantorPhone.trim() || undefined,
    signatureImageDataUrl: input.signatureImageDataUrl,
    createdAt,
    updatedAt: createdAt,
  };
  let next = { ...data, loans: [...data.loans, loan] };
  next = audit(next, "loan", loan.id, input.priorLoanId ? "renewed" : "created");
  if (loan.guarantorName) {
    if (next.rewards.some((reward) => reward.loanId === loan.id)) throw new Error("This loan already has a reward.");
    const reward: Reward = {
      id: makeId(),
      loanId: loan.id,
      borrowerId: loan.borrowerId,
      guarantorName: loan.guarantorName,
      guarantorPhone: loan.guarantorPhone ?? "",
      amountCentavos: input.rewardCentavos ?? data.settings.defaultRewardCentavos,
      state: "pending",
      note: "",
      createdAt,
      updatedAt: createdAt,
    };
    next = audit({ ...next, rewards: [...next.rewards, reward] }, "reward", reward.id, "created");
  }
  return { data: next, loan };
}

export function releaseLoan(
  data: AppData,
  loanId: string,
  releaseAmountCentavos: number,
  releaseDate: string,
  note: string,
): AppData {
  const loan = getLoan(data, loanId);
  if (loan.state !== "pending_release") throw new Error("Only a pending loan can be released.");
  if (!Number.isSafeInteger(releaseAmountCentavos) || releaseAmountCentavos <= 0) throw new Error("Release amount must be greater than zero.");
  if (!releaseDate) throw new Error("Release date is required.");
  if (releaseAmountCentavos !== loan.principalCentavos && !note.trim()) {
    throw new Error("Add a note when the released amount differs from the principal.");
  }
  const updated = data.loans.map((item) =>
    item.id === loanId
      ? { ...item, releaseAmountCentavos, releaseDate, notes: note.trim() || item.notes, state: "active" as const, updatedAt: nowIso() }
      : item,
  );
  return audit({ ...data, loans: updated }, "loan", loanId, "released", note.trim() || undefined);
}

export function recordPayment(
  data: AppData,
  input: { loanId: string; amountCentavos: number; receivedDate: string; note: string },
): AppData {
  const loan = getLoan(data, input.loanId);
  if (loan.deletedAt || loan.state !== "active") throw new Error("Payments can only be recorded against an active loan.");
  if (!Number.isSafeInteger(input.amountCentavos) || input.amountCentavos <= 0) throw new Error("Payment must be greater than zero.");
  if (!input.receivedDate) throw new Error("Received date is required.");
  const balance = getLoanBalance(data, loan.id);
  if (input.amountCentavos > balance) throw new Error(`Payment cannot exceed the current balance of ${formatMoney(balance)}.`);
  const payment: Payment = {
    id: makeId(),
    loanId: loan.id,
    amountCentavos: input.amountCentavos,
    receivedDate: input.receivedDate,
    note: input.note.trim(),
    kind: "payment",
    createdAt: nowIso(),
  };
  const closes = input.amountCentavos === balance;
  const loans = data.loans.map((item) =>
    item.id === loan.id
      ? { ...item, state: closes ? ("paid" as const) : item.state, paidDate: closes ? input.receivedDate : undefined, updatedAt: nowIso() }
      : item,
  );
  return audit({ ...data, payments: [...data.payments, payment], loans }, "payment", payment.id, "recorded");
}

export function deleteCancelledLoans(data: AppData): AppData {
  const cancelledIds = new Set(data.loans.filter((loan) => loan.state === "voided" && !loan.deletedAt).map((loan) => loan.id));
  if (!cancelledIds.size) return data;
  const deletedAt = nowIso();
  let next = { ...data, loans: data.loans.map((loan) => cancelledIds.has(loan.id) ? { ...loan, deletedAt, updatedAt: deletedAt } : loan) };
  for (const loanId of cancelledIds) next = audit(next, "loan", loanId, "deleted");
  return next;
}

export function deleteLoan(data: AppData, loanId: string): AppData {
  const loan = getLoan(data, loanId);
  if (loan.deletedAt) throw new Error("That loan has already been deleted.");
  const deletedAt = nowIso();
  const loans = data.loans.map((item) => item.id === loanId ? { ...item, deletedAt, updatedAt: deletedAt } : item);
  return audit({ ...data, loans }, "loan", loanId, "deleted");
}

export function deleteBorrower(data: AppData, borrowerId: string): AppData {
  const borrower = data.borrowers.find((item) => item.id === borrowerId);
  if (!borrower || borrower.deletedAt) throw new Error("Borrower not found.");
  const deletedAt = nowIso();
  const loanIds = new Set(data.loans.filter((loan) => loan.borrowerId === borrowerId && !loan.deletedAt).map((loan) => loan.id));
  const borrowers = data.borrowers.map((item) => item.id === borrowerId ? { ...item, deletedAt, updatedAt: deletedAt } : item);
  const loans = data.loans.map((loan) => loanIds.has(loan.id) ? { ...loan, deletedAt, updatedAt: deletedAt } : loan);
  return audit({ ...data, borrowers, loans }, "borrower", borrowerId, "deleted");
}

export function reversePayment(data: AppData, paymentId: string, reason: string): AppData {
  const original = data.payments.find((payment) => payment.id === paymentId);
  if (!original || original.kind !== "payment") throw new Error("Only an original payment can be reversed.");
  if (isPaymentReversed(data, paymentId)) throw new Error("That payment has already been reversed.");
  if (!reason.trim()) throw new Error("A correction reason is required.");
  const reversal: Payment = {
    id: makeId(),
    loanId: original.loanId,
    amountCentavos: -original.amountCentavos,
    receivedDate: todayLocal(),
    note: reason.trim(),
    kind: "reversal",
    reversalOf: original.id,
    createdAt: nowIso(),
  };
  const loan = getLoan(data, original.loanId);
  if (loan.deletedAt) throw new Error("That loan has been deleted.");
  const balanceAfter = getLoanBalance({ ...data, payments: [...data.payments, reversal] }, loan.id);
  const loans = data.loans.map((item) =>
    item.id === loan.id
      ? { ...item, state: balanceAfter === 0 ? ("paid" as const) : ("active" as const), paidDate: balanceAfter === 0 ? item.paidDate : undefined, updatedAt: nowIso() }
      : item,
  );
  return audit({ ...data, payments: [...data.payments, reversal], loans }, "payment", original.id, "reversed", reason.trim());
}

export function markRewardPaid(data: AppData, rewardId: string, paidDate: string): AppData {
  const reward = data.rewards.find((item) => item.id === rewardId);
  if (!reward) throw new Error("Reward not found.");
  if (reward.state === "paid") throw new Error("This reward has already been paid.");
  if (!paidDate) throw new Error("Paid date is required.");
  const rewards = data.rewards.map((item) =>
    item.id === rewardId ? { ...item, state: "paid" as const, paidDate, updatedAt: nowIso() } : item,
  );
  return audit({ ...data, rewards }, "reward", rewardId, "paid");
}

export function voidLoan(data: AppData, loanId: string, reason: string): AppData {
  const loan = getLoan(data, loanId);
  if (loan.deletedAt || loan.state !== "pending_release") throw new Error("A released loan must be resolved before it can be voided.");
  if (!reason.trim()) throw new Error("A void reason is required.");
  const loans = data.loans.map((item) =>
    item.id === loanId ? { ...item, state: "voided" as const, voidReason: reason.trim(), updatedAt: nowIso() } : item,
  );
  return audit({ ...data, loans }, "loan", loanId, "voided", reason.trim());
}

export function normalizeData(value: unknown): AppData {
  if (!value || typeof value !== "object") throw new Error("Backup data is not valid.");
  const candidate = value as Partial<AppData>;
  if (!Array.isArray(candidate.borrowers) || !Array.isArray(candidate.loans) || !Array.isArray(candidate.payments) || !Array.isArray(candidate.rewards)) {
    throw new Error("Backup is missing required records.");
  }
  const settings = candidate.settings ?? DEFAULT_SETTINGS;
  return {
    schemaVersion: 1,
    settings: {
      defaultPrincipalCentavos: Number(settings.defaultPrincipalCentavos) || DEFAULT_SETTINGS.defaultPrincipalCentavos,
      defaultTotalDueCentavos: Number(settings.defaultTotalDueCentavos) || DEFAULT_SETTINGS.defaultTotalDueCentavos,
      defaultTermDays: Number(settings.defaultTermDays) || DEFAULT_SETTINGS.defaultTermDays,
      defaultRewardCentavos: Number(settings.defaultRewardCentavos) || DEFAULT_SETTINGS.defaultRewardCentavos,
    },
    borrowers: candidate.borrowers as Borrower[],
    loans: candidate.loans as Loan[],
    payments: candidate.payments as Payment[],
    rewards: candidate.rewards as Reward[],
    audit: Array.isArray(candidate.audit) ? (candidate.audit as AuditEntry[]) : [],
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(data: AppData): string {
  const lines = [
    ["record_type", "id", "borrower", "loan_id", "state", "amount", "date", "details"].map(csvEscape).join(","),
  ];
  const borrowers = data.borrowers.filter((borrower) => !borrower.deletedAt);
  const loans = data.loans.filter((loan) => !loan.deletedAt);
  const borrowerIds = new Set(borrowers.map((borrower) => borrower.id));
  const loanIds = new Set(loans.map((loan) => loan.id));
  for (const borrower of borrowers) {
    lines.push(["borrower", borrower.id, borrower.fullName, "", "", "", borrower.createdAt.slice(0, 10), [borrower.phone, borrower.area, borrower.notes].filter(Boolean).join(" | ")].map(csvEscape).join(","));
  }
  for (const loan of loans) {
    lines.push(["loan", loan.id, borrowerName(data, loan.borrowerId), loan.id, loan.state, formatMoney(loan.totalDueCentavos), loan.startDate, `due ${loan.dueDate}; principal ${formatMoney(loan.principalCentavos)}`].map(csvEscape).join(","));
  }
  for (const payment of data.payments) {
    if (!loanIds.has(payment.loanId)) continue;
    lines.push([payment.kind, payment.id, borrowerName(data, getLoan(data, payment.loanId).borrowerId), payment.loanId, payment.kind, formatMoney(payment.amountCentavos), payment.receivedDate, payment.note].map(csvEscape).join(","));
  }
  for (const reward of data.rewards) {
    if (!loanIds.has(reward.loanId) || !borrowerIds.has(reward.borrowerId)) continue;
    lines.push(["reward", reward.id, borrowerName(data, reward.borrowerId), reward.loanId, reward.state, formatMoney(reward.amountCentavos), reward.paidDate ?? "", reward.guarantorName].map(csvEscape).join(","));
  }
  return lines.join("\n");
}
