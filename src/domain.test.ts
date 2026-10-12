import { describe, expect, it } from "vitest";
import {
  addBorrower,
  createLoan,
  deleteBorrower,
  deleteLoan,
  deleteCancelledLoans,
  emptyData,
  getLoanDayStats,
  getLoanBalance,
  markRewardPaid,
  recordPayment,
  releaseLoan,
  reversePayment,
  totalDueForPrincipal,
  voidLoan,
} from "./domain";

function fixture() {
  const withBorrower = addBorrower(emptyData(), { fullName: "Ana Cruz", phone: "09171234567", area: "Makati", notes: "" });
  const borrower = withBorrower.borrowers[0];
  const created = createLoan(withBorrower, {
    borrowerId: borrower.id,
    principalCentavos: 1_000_000,
    startDate: "2026-01-01",
    dueDate: "2026-02-10",
    termDays: 40,
    notes: "",
    guarantorName: "Ben Cruz",
    guarantorPhone: "",
    signatureImageDataUrl: "data:image/png;base64,signature",
  });
  return { data: created.data, loan: created.loan, borrower };
}

describe("debt ledger rules", () => {
  it("keeps a new loan pending until release and calculates centavo balances", () => {
    const { data, loan } = fixture();
    expect(loan.state).toBe("pending_release");
    expect(loan.signatureImageDataUrl).toContain("data:image/png");
    expect(getLoanBalance(data, loan.id)).toBe(1_200_000);
    const released = releaseLoan(data, loan.id, 1_000_000, "2026-01-01", "");
    const paid = recordPayment(released, { loanId: loan.id, amountCentavos: 30_000, receivedDate: "2026-01-02", note: "" });
    expect(getLoanBalance(paid, loan.id)).toBe(1_170_000);
    expect(paid.payments[0].proofImageDataUrl).toBeUndefined();
    expect(paid.loans.find((item) => item.id === loan.id)?.state).toBe("active");
  });

  it("rejects invalid and over-balance payments", () => {
    const { data, loan } = fixture();
    const released = releaseLoan(data, loan.id, 1_000_000, "2026-01-01", "");
    expect(() => recordPayment(released, { loanId: loan.id, amountCentavos: 0, receivedDate: "2026-01-02", note: "" })).toThrow();
    expect(() => recordPayment(released, { loanId: loan.id, amountCentavos: 1_200_001, receivedDate: "2026-01-02", note: "" })).toThrow();
  });

  it("marks the loan paid and reopens it when a payment is reversed", () => {
    const { data, loan } = fixture();
    const released = releaseLoan(data, loan.id, 1_000_000, "2026-01-01", "");
    const paid = recordPayment(released, { loanId: loan.id, amountCentavos: 1_200_000, receivedDate: "2026-01-02", note: "" });
    const original = paid.payments[paid.payments.length - 1];
    expect(paid.loans.find((item) => item.id === loan.id)?.state).toBe("paid");
    const corrected = reversePayment(paid, original.id, "Entered the wrong payment.");
    expect(getLoanBalance(corrected, loan.id)).toBe(1_200_000);
    expect(corrected.loans.find((item) => item.id === loan.id)?.state).toBe("active");
    expect(() => reversePayment(corrected, original.id, "Again")).toThrow();
  });

  it("creates one pending reward and prevents a second payout", () => {
    const { data, loan } = fixture();
    const reward = data.rewards.find((item) => item.loanId === loan.id);
    expect(reward?.state).toBe("pending");
    const paid = markRewardPaid(data, reward!.id, "2026-01-03");
    expect(paid.rewards.find((item) => item.id === reward!.id)?.state).toBe("paid");
    expect(() => markRewardPaid(paid, reward!.id, "2026-01-04")).toThrow();
  });

  it("renews without changing the prior loan or its ledger", () => {
    const { data, loan, borrower } = fixture();
    const released = releaseLoan(data, loan.id, 1_000_000, "2026-01-01", "");
    const paid = recordPayment(released, { loanId: loan.id, amountCentavos: 1_200_000, receivedDate: "2026-01-02", note: "" });
    const renewed = createLoan(paid, {
      borrowerId: borrower.id,
      principalCentavos: 500_000,
      startDate: "2026-02-11",
      dueDate: "2026-03-23",
      termDays: 40,
      notes: "",
      guarantorName: "",
      guarantorPhone: "",
      priorLoanId: loan.id,
      signatureImageDataUrl: "data:image/png;base64,renewed-signature",
    });
    expect(renewed.loan.priorLoanId).toBe(loan.id);
    expect(renewed.data.loans.find((item) => item.id === loan.id)?.state).toBe("paid");
    expect(renewed.data.payments).toHaveLength(1);
    expect(renewed.loan.id).not.toBe(loan.id);
  });

  it("requires one signature photo for each new loan", () => {
    const withBorrower = addBorrower(emptyData(), { fullName: "Ana Cruz", phone: "", area: "", notes: "" });
    const borrower = withBorrower.borrowers[0];
    expect(() => createLoan(withBorrower, {
      borrowerId: borrower.id,
      principalCentavos: 1_000_000,
      startDate: "2026-01-01",
      dueDate: "2026-02-10",
      termDays: 40,
      notes: "",
      guarantorName: "",
      guarantorPhone: "",
      signatureImageDataUrl: "",
    })).toThrow("signature photo");
  });

  it("calculates total due as principal plus 20 percent", () => {
    expect(totalDueForPrincipal(2_000_000)).toBe(2_400_000);
  });

  it("deletes cancelled loans without touching borrowers", () => {
    const { data, loan, borrower } = fixture();
    const cancelled = voidLoan(data, loan.id, "Borrower changed plans.");
    const cleaned = deleteCancelledLoans(cancelled);
    expect(cleaned.loans.filter((item) => !item.deletedAt)).toHaveLength(0);
    expect(cleaned.borrowers[0].id).toBe(borrower.id);
  });

  it("counts passed and no-payment days from the loan timeline", () => {
    const { data, loan } = fixture();
    const released = releaseLoan(data, loan.id, 1_000_000, "2026-01-01", "");
    const paid = recordPayment(released, { loanId: loan.id, amountCentavos: 30_000, receivedDate: "2026-01-05", note: "" });
    expect(getLoanDayStats(paid, loan, "2026-01-08")).toEqual({ daysPassed: 7, noPaymentDays: 3, lastPaymentDate: "2026-01-05" });
  });

  it("keeps deleted borrower and loan records recoverable", () => {
    const { data, loan, borrower } = fixture();
    const deletedLoan = deleteLoan(data, loan.id);
    expect(deletedLoan.loans[0].deletedAt).toBeTruthy();
    expect(deletedLoan.payments).toHaveLength(0);
    const deletedBorrower = deleteBorrower(data, borrower.id);
    expect(deletedBorrower.borrowers[0].deletedAt).toBeTruthy();
    expect(deletedBorrower.loans[0].deletedAt).toBeTruthy();
  });
});
