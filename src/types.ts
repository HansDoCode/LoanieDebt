export type LoanState = "pending_release" | "active" | "paid" | "voided";
export type PaymentKind = "payment" | "reversal";
export type RewardState = "pending" | "paid";

export interface Borrower {
  id: string;
  fullName: string;
  phone: string;
  area: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Loan {
  id: string;
  borrowerId: string;
  priorLoanId?: string;
  principalCentavos: number;
  totalDueCentavos: number;
  startDate: string;
  dueDate: string;
  termDays: number;
  releaseAmountCentavos?: number;
  releaseDate?: string;
  state: LoanState;
  notes: string;
  voidReason?: string;
  paidDate?: string;
  guarantorName?: string;
  guarantorPhone?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Payment {
  id: string;
  loanId: string;
  amountCentavos: number;
  receivedDate: string;
  note: string;
  kind: PaymentKind;
  reversalOf?: string;
  proofImageDataUrl?: string;
  createdAt: string;
}

export interface Reward {
  id: string;
  loanId: string;
  borrowerId: string;
  guarantorName: string;
  guarantorPhone: string;
  amountCentavos: number;
  state: RewardState;
  paidDate?: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  entityType: "borrower" | "loan" | "payment" | "reward";
  entityId: string;
  action: string;
  reason?: string;
  createdAt: string;
}

export interface AppSettings {
  defaultPrincipalCentavos: number;
  defaultTotalDueCentavos: number;
  defaultTermDays: number;
  defaultRewardCentavos: number;
}

export interface AppData {
  schemaVersion: 1;
  settings: AppSettings;
  borrowers: Borrower[];
  loans: Loan[];
  payments: Payment[];
  rewards: Reward[];
  audit: AuditEntry[];
}
