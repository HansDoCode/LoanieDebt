import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import {
  addBorrower,
  addDays,
  borrowerName,
  createLoan,
  deleteCancelledLoans,
  emptyData,
  exportCsv,
  formatDate,
  formatMoney,
  getLoan,
  getLoanBalance,
  getLoanPayments,
  isPaymentReversed,
  likelyDuplicateBorrowers,
  loanDisplayStatus,
  markRewardPaid,
  moneyInputValue,
  normalizeData,
  nowIso,
  parseMoney,
  recordPayment,
  releaseLoan,
  reversePayment,
  todayLocal,
  updateBorrower,
  voidLoan,
} from "./domain";
import { cloudConfigured, loadData, saveData, supabase } from "./repository";
import type { AppData, AppSettings, Borrower, Loan, Payment, Reward } from "./types";

type View = "home" | "loans" | "borrowers" | "more";
type ModalState =
  | { kind: "borrower"; borrowerId?: string }
  | { kind: "loan"; borrowerId?: string; priorLoanId?: string }
  | { kind: "payment"; loanId?: string }
  | { kind: "loanDetail"; loanId: string }
  | { kind: "release"; loanId: string }
  | { kind: "reverse"; paymentId: string }
  | { kind: "void"; loanId: string }
  | { kind: "restore"; data: AppData };

const localPinKey = "lanies-debt-manager:owner-pin:v1";

function getSessionUser(session: { user?: { id: string; email?: string | null } } | null) {
  return session?.user ? { id: session.user.id, email: session.user.email ?? "" } : null;
}

async function hashPin(pin: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return btoa(pin);
}

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: ReturnType<typeof loanDisplayStatus>): string {
  return {
    pending_release: "Pending release",
    active: "Active",
    due_soon: "Due soon",
    overdue: "Overdue",
    paid: "Fully paid",
    voided: "Cancelled",
  }[status];
}

function statusClass(status: ReturnType<typeof loanDisplayStatus>): string {
  return `status status-${status}`;
}

function loanPriority(loan: Loan): number {
  return loan.state === "active" ? 0 : loan.state === "pending_release" ? 1 : loan.state === "paid" ? 2 : 3;
}

function sortLoansByPriority(loans: Loan[]): Loan[] {
  return [...loans].sort((a, b) => {
    const priorityDifference = loanPriority(a) - loanPriority(b);
    if (priorityDifference) return priorityDifference;
    if (a.state === "active" && b.state === "active") return a.dueDate.localeCompare(b.dueDate);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ErrorText({ children }: { children: ReactNode }) {
  return <p className="form-error" role="alert">{children}</p>;
}

function StatusChip({ status }: { status: ReturnType<typeof loanDisplayStatus> }) {
  return <span className={statusClass(status)}>{statusLabel(status)}</span>;
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">○</div><h3>{title}</h3><p>{children}</p></div>;
}

function CloudAuth({ onError }: { onError: (message: string) => void }) {
  const [signUp, setSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    onError("");
    setBusy(true);
    try {
      if (!supabase) throw new Error("Supabase is not configured.");
      const result = signUp
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signUp && !result.data.session) setMessage("Account created. Check your email if confirmation is enabled, then sign in.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark large">₱</div>
        <h1>{signUp ? "Create your account" : "Welcome back"}</h1>
        <p className="muted">Your records are private to your account.</p>
        <form className="stack" onSubmit={submit}>
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Password<input type="password" autoComplete={signUp ? "new-password" : "current-password"} minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {message && <p className="success-text">{message}</p>}
          <button className="button button-primary button-block" type="submit" disabled={busy}>{busy ? "Working…" : signUp ? "Create account" : "Sign in"}</button>
        </form>
        <button className="button button-link" type="button" onClick={() => { setSignUp((value) => !value); setMessage(""); }}>
          {signUp ? "Already have an account? Sign in" : "New owner? Create an account"}
        </button>
      </div>
    </main>
  );
}

function LocalLock({ configured, onUnlock, onError }: { configured: boolean; onUnlock: () => void; onError: (message: string) => void }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    onError("");
    if (!/^\d{4,8}$/.test(pin)) {
      onError("Use a 4–8 digit PIN.");
      return;
    }
    if (!configured && pin !== confirm) {
      onError("The PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      const saved = localStorage.getItem(localPinKey);
      const hash = await hashPin(pin);
      if (configured && saved !== hash) throw new Error("That PIN is not correct.");
      if (!configured) localStorage.setItem(localPinKey, hash);
      onUnlock();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not unlock the app.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark large">₱</div>
        <h1>{configured ? "Unlock your records" : "Protect your records"}</h1>
        <p className="muted">{configured ? "Enter your PIN to continue." : "Set a PIN for this browser. Online storage is not connected yet."}</p>
        <form className="stack" onSubmit={submit}>
          <label>Owner PIN<input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" minLength={4} maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} required /></label>
          {!configured && <label>Confirm PIN<input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" minLength={4} maxLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ""))} required /></label>}
          <button className="button button-primary button-block" type="submit" disabled={busy}>{busy ? "Checking…" : configured ? "Unlock" : "Set PIN"}</button>
        </form>
        <p className="fine-print">Local demo data is stored in this browser only. Connect online storage before relying on it for your records.</p>
      </div>
    </main>
  );
}

function LoanCard({ data, loan, onOpen, onPay }: { data: AppData; loan: Loan; onOpen: () => void; onPay: () => void }) {
  const status = loanDisplayStatus(data, loan);
  const balance = getLoanBalance(data, loan.id);
  return (
    <article className="record-card">
      <div className="record-card-top">
        <div>
          <p className="record-kicker">{borrowerName(data, loan.borrowerId)}</p>
          <h3>{formatMoney(balance)} <span className="balance-label">remaining</span></h3>
        </div>
        <StatusChip status={status} />
      </div>
      <div className="record-meta">
        <span>Total due {formatMoney(loan.totalDueCentavos)}</span>
        <span>Due {formatDate(loan.dueDate)}</span>
      </div>
      <div className="record-actions">
        <button className="button button-secondary" type="button" onClick={onOpen}>Open loan</button>
        {loan.state === "active" && <button className="button button-primary" type="button" onClick={onPay}>Record payment</button>}
      </div>
    </article>
  );
}

function App() {
  const [cloudSession, setCloudSession] = useState<{ id: string; email: string } | null>(null);
  const [localPinConfigured, setLocalPinConfigured] = useState(false);
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const [authReady, setAuthReady] = useState(!cloudConfigured);
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("home");
  const [modal, setModal] = useState<ModalState | null>(null);
  const [borrowerProfileId, setBorrowerProfileId] = useState<string | null>(null);
  const [loanSearch, setLoanSearch] = useState("");
  const [loanFilter, setLoanFilter] = useState("all");
  const [borrowerSearch, setBorrowerSearch] = useState("");
  const [restoreCandidate, setRestoreCandidate] = useState<AppData | null>(null);

  useEffect(() => {
    if (!cloudConfigured || !supabase) {
      setLocalPinConfigured(Boolean(localStorage.getItem(localPinKey)));
      setAuthReady(true);
      return;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) setError(sessionError.message);
      setCloudSession(getSessionUser(sessionData.session));
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCloudSession(getSessionUser(session));
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const activeOwnerId = cloudConfigured ? cloudSession?.id : undefined;
  const readyForData = cloudConfigured ? Boolean(cloudSession) : localUnlocked;

  useEffect(() => {
    if (!readyForData) return;
    let mounted = true;
    setLoading(true);
    setError("");
    loadData(activeOwnerId)
      .then((loaded) => { if (mounted) setData(loaded); })
      .catch((loadError) => { if (mounted) setError(loadError instanceof Error ? loadError.message : "Could not load your records."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [activeOwnerId, readyForData]);

  async function commit(next: AppData) {
    setSaving(true);
    setError("");
    try {
      await saveData(next, activeOwnerId);
      setData(next);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Could not save that change.";
      setError(`${message} Your form is still open so you can retry.`);
      throw saveError;
    } finally {
      setSaving(false);
    }
  }

  async function lock() {
    setModal(null);
    if (cloudConfigured && supabase) {
      await supabase.auth.signOut();
    } else {
      setLocalUnlocked(false);
      setLocalPinConfigured(Boolean(localStorage.getItem(localPinKey)));
    }
  }

  const today = todayLocal();
  const summary = useMemo(() => {
    const todayCollected = data.payments.filter((payment) => payment.kind === "payment" && payment.receivedDate === today).reduce((sum, payment) => sum + payment.amountCentavos, 0);
    const activeLoans = data.loans.filter((loan) => loan.state === "active");
    const dueSoon = activeLoans.filter((loan) => loanDisplayStatus(data, loan) === "due_soon");
    const overdue = activeLoans.filter((loan) => loanDisplayStatus(data, loan) === "overdue");
    return {
      todayCollected,
      todayPayments: data.payments.filter((payment) => payment.kind === "payment" && payment.receivedDate === today).length,
      activeCount: activeLoans.length,
      outstanding: activeLoans.reduce((sum, loan) => sum + getLoanBalance(data, loan.id), 0),
      dueSoon,
      overdue,
    };
  }, [data, today]);

  const recentPayments = useMemo(() => [...data.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8), [data.payments]);

  const filteredLoans = useMemo(() => {
    const query = loanSearch.trim().toLowerCase();
    return sortLoansByPriority(data.loans.filter((loan) => {
      const status = loanDisplayStatus(data, loan);
      const borrower = data.borrowers.find((item) => item.id === loan.borrowerId);
      const textMatch = !query || [borrower?.fullName, borrower?.phone, borrower?.id, loan.id, borrower?.area].some((value) => value?.toLowerCase().includes(query));
      const stateMatch = loanFilter === "all" || loanFilter === status || loanFilter === loan.state;
      return textMatch && stateMatch;
    }));
  }, [data, loanFilter, loanSearch]);

  const filteredBorrowers = useMemo(() => {
    const query = borrowerSearch.trim().toLowerCase();
    return data.borrowers.filter((borrower) => !query || [borrower.fullName, borrower.phone, borrower.id, borrower.area].some((value) => value.toLowerCase().includes(query))).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [borrowerSearch, data.borrowers]);

  if (!authReady) return <main className="auth-shell"><div className="loading-card">Loading secure access…</div></main>;
  if (cloudConfigured && !cloudSession) return <><CloudAuth onError={setError} />{error && <div className="global-auth-error"><ErrorText>{error}</ErrorText></div>}</>;
  if (!cloudConfigured && !localUnlocked) return <><LocalLock configured={localPinConfigured} onUnlock={() => setLocalUnlocked(true)} onError={setError} />{error && <div className="global-auth-error"><ErrorText>{error}</ErrorText></div>}</>;

  function openBorrower(id: string) {
    setBorrowerProfileId(id);
    setView("borrowers");
  }

  function openLoan(id: string) {
    setModal({ kind: "loanDetail", loanId: id });
  }

  async function removeCancelledLoans() {
    const cancelledCount = data.loans.filter((loan) => loan.state === "voided").length;
    if (!cancelledCount || !window.confirm(`Delete ${cancelledCount} cancelled loan${cancelledCount === 1 ? "" : "s"}? This cannot be undone.`)) return;
    try {
      await commit(deleteCancelledLoans(data));
    } catch {
      // The save error is shown above and the records remain unchanged.
    }
  }

  async function handleRestore() {
    if (!restoreCandidate) return;
    try {
      await commit(restoreCandidate);
      setRestoreCandidate(null);
      setModal(null);
      setView("home");
    } catch {
      // commit keeps the error and leaves the confirmation available.
    }
  }

  async function readBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { data?: unknown } | unknown;
      setRestoreCandidate(normalizeData(typeof parsed === "object" && parsed !== null && "data" in parsed ? (parsed as { data: unknown }).data : parsed));
      setModal({ kind: "restore", data: emptyData() });
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "That backup could not be read.");
    }
  }

  const profile = borrowerProfileId ? data.borrowers.find((borrower) => borrower.id === borrowerProfileId) : undefined;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">₱</div>
          <div><strong>Loanie's Debt</strong></div>
        </div>
        <div className="topbar-actions">
          <span className={`mode-badge ${cloudConfigured ? "mode-cloud" : "mode-local"}`}>{cloudConfigured ? "Cloud" : "Local demo"}</span>
          <button className="button button-quiet" type="button" onClick={() => void lock()}>Lock</button>
        </div>
      </header>

      {error && <div className="app-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
      {loading && <div className="loading-bar" aria-label="Loading" />}

      <main className="page-content">
        {view === "home" && (
          <HomeView
            data={data}
            summary={summary}
            recentPayments={recentPayments}
            onRecordPayment={() => setModal({ kind: "payment" })}
            onOpenLoan={openLoan}
            onOpenLoans={(filter) => { setLoanFilter(filter); setView("loans"); }}
            onOpenBorrower={openBorrower}
            onAddBorrower={() => setModal({ kind: "borrower" })}
          />
        )}
        {view === "loans" && (
          <section className="page-section">
            <PageHeading title="Loans" action={<div className="heading-actions">{data.loans.some((loan) => loan.state === "voided") && <button className="button button-danger" type="button" onClick={() => void removeCancelledLoans()}>Delete all cancelled</button>}<button className="button button-primary" type="button" onClick={() => setModal({ kind: "loan" })}>+ New loan</button></div>} />
            <div className="filter-row"><label className="search-field"><span aria-hidden="true">⌕</span><input placeholder="Search borrower, phone, ID, or area" value={loanSearch} onChange={(event) => setLoanSearch(event.target.value)} /></label><select aria-label="Filter loans" value={loanFilter} onChange={(event) => setLoanFilter(event.target.value)}><option value="all">All loans</option><option value="active">Active</option><option value="due_soon">Due soon</option><option value="overdue">Overdue</option><option value="pending_release">Pending release</option><option value="paid">Fully paid</option><option value="voided">Cancelled</option></select></div>
            {filteredLoans.length ? <div className="record-grid">{filteredLoans.map((loan) => <LoanCard key={loan.id} data={data} loan={loan} onOpen={() => openLoan(loan.id)} onPay={() => setModal({ kind: "payment", loanId: loan.id })} />)}</div> : <EmptyState title="No loans found">Create a loan or clear the search to see your records.</EmptyState>}
          </section>
        )}
        {view === "borrowers" && (
          <BorrowersView
            data={data}
            profile={profile}
            search={borrowerSearch}
            borrowers={filteredBorrowers}
            onSearch={setBorrowerSearch}
            onBack={() => setBorrowerProfileId(null)}
            onAdd={() => setModal({ kind: "borrower" })}
            onOpenProfile={openBorrower}
            onEdit={(borrowerId) => setModal({ kind: "borrower", borrowerId })}
            onOpenLoan={openLoan}
            onNewLoan={(borrowerId, priorLoanId) => setModal({ kind: "loan", borrowerId, priorLoanId })}
            onPay={(loanId) => setModal({ kind: "payment", loanId })}
          />
        )}
        {view === "more" && (
          <MoreView
            data={data}
            saving={saving}
            onPayReward={async (rewardId) => { try { await commit(markRewardPaid(data, rewardId, todayLocal())); } catch { /* error is shown above */ } }}
            onSaveSettings={async (settings) => { try { await commit({ ...data, settings }); } catch { /* error is shown above */ } }}
            onBackup={() => downloadFile(`lanies-debt-backup-${todayLocal()}.json`, JSON.stringify({ backupVersion: 1, createdAt: nowIso(), data }, null, 2), "application/json")}
            onCsv={() => downloadFile(`lanies-debt-export-${todayLocal()}.csv`, exportCsv(data), "text/csv;charset=utf-8")}
            onRestore={readBackup}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {(["home", "loans", "borrowers", "more"] as View[]).map((item) => <button key={item} className={view === item ? "nav-item active" : "nav-item"} type="button" onClick={() => { setView(item); if (item !== "borrowers") setBorrowerProfileId(null); }}><span className="nav-icon" aria-hidden="true">{item === "home" ? "⌂" : item === "loans" ? "▤" : item === "borrowers" ? "♙" : "⋯"}</span><span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}
      </nav>

      {modal?.kind === "borrower" && <BorrowerForm data={data} borrowerId={modal.borrowerId} saving={saving} commit={commit} onClose={() => setModal(null)} onProfile={openBorrower} />}
      {modal?.kind === "loan" && <LoanForm data={data} borrowerId={modal.borrowerId} priorLoanId={modal.priorLoanId} saving={saving} commit={commit} onClose={() => setModal(null)} />}
      {modal?.kind === "payment" && <PaymentForm data={data} loanId={modal.loanId} saving={saving} commit={commit} onClose={() => setModal(null)} />}
      {modal?.kind === "release" && <ReleaseForm data={data} loanId={modal.loanId} saving={saving} commit={commit} onClose={() => setModal(null)} />}
      {modal?.kind === "reverse" && <ReverseForm data={data} paymentId={modal.paymentId} saving={saving} commit={commit} onClose={() => setModal(null)} />}
      {modal?.kind === "void" && <VoidForm data={data} loanId={modal.loanId} saving={saving} commit={commit} onClose={() => setModal(null)} />}
      {modal?.kind === "loanDetail" && <LoanDetail data={data} loanId={modal.loanId} onClose={() => setModal(null)} onPay={(loanId) => setModal({ kind: "payment", loanId })} onRelease={(loanId) => setModal({ kind: "release", loanId })} onReverse={(paymentId) => setModal({ kind: "reverse", paymentId })} onVoid={(loanId) => setModal({ kind: "void", loanId })} onRenew={(loanId) => setModal({ kind: "loan", priorLoanId: loanId })} onOpenLoan={openLoan} />}
      {modal?.kind === "restore" && restoreCandidate && <Modal title="Replace all records?" onClose={() => { setModal(null); setRestoreCandidate(null); }}><div className="stack"><p>This will replace the current borrowers, loans, payments, rewards, and settings with the selected backup. This cannot be undone from the app.</p><div className="warning-box">Make another backup first if the current records contain anything new.</div><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => { setModal(null); setRestoreCandidate(null); }}>Cancel</button><button className="button button-danger" type="button" disabled={saving} onClick={() => void handleRestore()}>{saving ? "Restoring…" : "Replace and restore"}</button></div></div></Modal>}
    </div>
  );
}

function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1></div>{action}</div>;
}

function HomeView({ data, summary, recentPayments, onRecordPayment, onOpenLoan, onOpenLoans, onOpenBorrower, onAddBorrower }: { data: AppData; summary: { todayCollected: number; todayPayments: number; activeCount: number; outstanding: number; dueSoon: Loan[]; overdue: Loan[] }; recentPayments: Payment[]; onRecordPayment: () => void; onOpenLoan: (id: string) => void; onOpenLoans: (filter: string) => void; onOpenBorrower: (id: string) => void; onAddBorrower: () => void }) {
  return <section className="page-section home-section">
    <PageHeading title="Home" action={<button className="button button-primary button-large" type="button" onClick={onRecordPayment}>＋ Record payment</button>} />
    <div className="summary-grid">
      <SummaryCard label="Collected today" value={formatMoney(summary.todayCollected)} detail={`${summary.todayPayments} payment${summary.todayPayments === 1 ? "" : "s"}`} accent="gold" />
      <SummaryCard label="Unpaid balance" value={formatMoney(summary.outstanding)} detail={`${summary.activeCount} active loan${summary.activeCount === 1 ? "" : "s"}`} accent="teal" />
      <button className="summary-card summary-action" type="button" onClick={() => onOpenLoans("due_soon")}><span className="summary-label">Due soon</span><strong>{summary.dueSoon.length}</strong><span className="summary-detail">Next 7 days <span>→</span></span></button>
      <button className="summary-card summary-action alert-card" type="button" onClick={() => onOpenLoans("overdue")}><span className="summary-label">Overdue</span><strong>{summary.overdue.length}</strong><span className="summary-detail">Needs attention <span>→</span></span></button>
    </div>
    <div className="home-columns">
      <div className="panel"><div className="panel-heading"><div><h2>Due soon and overdue</h2></div><button className="button button-link" type="button" onClick={() => onOpenLoans("all")}>View all</button></div>
        {[...summary.overdue, ...summary.dueSoon].slice(0, 5).map((loan) => <button className="compact-record" type="button" key={loan.id} onClick={() => onOpenLoan(loan.id)}><span className="avatar">{borrowerName(data, loan.borrowerId).slice(0, 1).toUpperCase()}</span><span className="compact-record-main"><strong>{borrowerName(data, loan.borrowerId)}</strong><small>Due {formatDate(loan.dueDate)}</small></span><span className="compact-record-side"><strong>{formatMoney(getLoanBalance(data, loan.id))}</strong><StatusChip status={loanDisplayStatus(data, loan)} /></span></button>)}
        {!summary.overdue.length && !summary.dueSoon.length && <p className="muted panel-empty">Nothing needs attention in the next 7 days.</p>}
      </div>
      <div className="panel"><div className="panel-heading"><div><h2>Recent activity</h2></div><button className="button button-link" type="button" onClick={() => onOpenLoans("all")}>All loans</button></div>
        {recentPayments.slice(0, 5).map((payment) => { const loan = data.loans.find((item) => item.id === payment.loanId); if (!loan) return null; const borrower = data.borrowers.find((item) => item.id === loan.borrowerId); return <button className="compact-record" type="button" key={payment.id} onClick={() => onOpenBorrower(loan.borrowerId)}><span className={`activity-dot ${payment.kind === "reversal" ? "reversal-dot" : ""}`}>{payment.kind === "reversal" ? "↶" : "₱"}</span><span className="compact-record-main"><strong>{borrower?.fullName ?? "Unknown borrower"}</strong><small>{payment.kind === "reversal" ? "Correction" : "Payment"} · {formatDate(payment.receivedDate)}</small></span><span className={`compact-record-amount ${payment.amountCentavos < 0 ? "negative" : ""}`}>{payment.amountCentavos < 0 ? "−" : "+"}{formatMoney(Math.abs(payment.amountCentavos))}</span></button>; })}
        {!recentPayments.length && <p className="muted panel-empty">Payments will appear here after the first collection.</p>}
      </div>
    </div>
    {!data.borrowers.length && <div className="onboarding-card"><div><h2>Start with a borrower</h2><p>Add the person before creating a loan. Every payment stays tied to the right person and loan.</p></div><button className="button button-primary" type="button" onClick={onAddBorrower}>Add borrower</button></div>}
  </section>;
}

function SummaryCard({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return <div className={`summary-card accent-${accent}`}><span className="summary-label">{label}</span><strong>{value}</strong><span className="summary-detail">{detail}</span></div>;
}

function BorrowersView({ data, profile, search, borrowers, onSearch, onBack, onAdd, onOpenProfile, onEdit, onOpenLoan, onNewLoan, onPay }: { data: AppData; profile?: Borrower; search: string; borrowers: Borrower[]; onSearch: (value: string) => void; onBack: () => void; onAdd: () => void; onOpenProfile: (id: string) => void; onEdit: (id: string) => void; onOpenLoan: (id: string) => void; onNewLoan: (borrowerId: string, priorLoanId?: string) => void; onPay: (loanId: string) => void }) {
  if (profile) {
    const loans = sortLoansByPriority(data.loans.filter((loan) => loan.borrowerId === profile.id));
    const outstanding = loans.filter((loan) => loan.state === "active").reduce((sum, loan) => sum + getLoanBalance(data, loan.id), 0);
    return <section className="page-section"><button className="button button-link back-button" type="button" onClick={onBack}>← All borrowers</button><div className="profile-header"><div className="profile-avatar">{profile.fullName.slice(0, 1).toUpperCase()}</div><div className="profile-heading"><h1>{profile.fullName}</h1><p className="muted">{profile.phone || "No phone added"}{profile.area ? ` · ${profile.area}` : ""}</p></div><button className="button button-secondary" type="button" onClick={() => onEdit(profile.id)}>Edit</button></div><div className="profile-stats"><div><span>Unpaid balance</span><strong>{formatMoney(outstanding)}</strong></div><div><span>Loans</span><strong>{loans.length}</strong></div><div><span>Payments</span><strong>{data.payments.filter((payment) => loans.some((loan) => loan.id === payment.loanId)).filter((payment) => payment.kind === "payment").length}</strong></div></div><div className="profile-actions"><button className="button button-primary" type="button" onClick={() => onNewLoan(profile.id)}>＋ New loan for this borrower</button></div>{profile.notes && <div className="note-box"><strong>Notes</strong><p>{profile.notes}</p></div>}<div className="panel profile-loans"><div className="panel-heading"><div><h2>Loans and payments</h2></div></div>{loans.map((loan) => <div className="profile-loan" key={loan.id}><div className="profile-loan-heading"><div><button className="text-button" type="button" onClick={() => onOpenLoan(loan.id)}><strong>{formatMoney(loan.totalDueCentavos)} loan</strong></button><small>Started {formatDate(loan.startDate)} · Due {formatDate(loan.dueDate)}</small></div><StatusChip status={loanDisplayStatus(data, loan)} /></div><div className="profile-loan-meta"><span>Unpaid balance <strong>{formatMoney(getLoanBalance(data, loan.id))}</strong></span><span>{getLoanPayments(data, loan.id).length} payment record{getLoanPayments(data, loan.id).length === 1 ? "" : "s"}</span>{loan.state === "active" && <button className="button button-small button-primary" type="button" onClick={() => onPay(loan.id)}>Record payment</button>}{loan.state === "paid" && <button className="button button-small button-secondary" type="button" onClick={() => onNewLoan(profile.id, loan.id)}>Renew</button>}</div></div>)}{!loans.length && <EmptyState title="No loans yet">Create the first loan for this borrower.</EmptyState>}</div></section>;
  }
  return <section className="page-section"><PageHeading title="Borrowers" action={<button className="button button-primary" type="button" onClick={onAdd}>＋ Add borrower</button>} /><label className="search-field full-search"><span aria-hidden="true">⌕</span><input placeholder="Search name, phone, ID, or area" value={search} onChange={(event) => onSearch(event.target.value)} /></label>{borrowers.length ? <div className="record-grid borrower-grid">{borrowers.map((borrower) => { const loans = data.loans.filter((loan) => loan.borrowerId === borrower.id); const activeBalance = loans.filter((loan) => loan.state === "active").reduce((sum, loan) => sum + getLoanBalance(data, loan.id), 0); return <button className="borrower-card" type="button" key={borrower.id} onClick={() => onOpenProfile(borrower.id)}><span className="avatar large-avatar">{borrower.fullName.slice(0, 1).toUpperCase()}</span><span className="borrower-card-main"><strong>{borrower.fullName}</strong><small>{borrower.phone || "No phone"}{borrower.area ? ` · ${borrower.area}` : ""}</small><small>{loans.length} loan{loans.length === 1 ? "" : "s"}</small></span><span className="borrower-card-side"><strong>{formatMoney(activeBalance)}</strong><small>unpaid balance</small></span></button>; })}</div> : <EmptyState title="No borrowers found">Add a borrower to start the records.</EmptyState>}</section>;
}

function MoreView({ data, saving, onPayReward, onSaveSettings, onBackup, onCsv, onRestore }: { data: AppData; saving: boolean; onPayReward: (id: string) => Promise<void>; onSaveSettings: (settings: AppSettings) => Promise<void>; onBackup: () => void; onCsv: () => void; onRestore: (event: ChangeEvent<HTMLInputElement>) => Promise<void> }) {
  const pendingRewards = data.rewards.filter((reward) => reward.state === "pending");
  const paidRewards = data.rewards.filter((reward) => reward.state === "paid");
  return <section className="page-section"><PageHeading title="More" /><div className="more-grid"><section className="panel"><div className="panel-heading"><div><h2>Guarantor rewards</h2></div><span className="count-badge">{pendingRewards.length} pending</span></div>{data.rewards.map((reward) => <RewardRow key={reward.id} data={data} reward={reward} saving={saving} onPay={() => void onPayReward(reward.id)} />)}{!data.rewards.length && <p className="muted panel-empty">Rewards appear here when a loan has a guarantor.</p>}{paidRewards.length > 0 && <p className="fine-print">Paid rewards stay in the records and cannot be paid twice.</p>}</section><SettingsPanel data={data} saving={saving} onSave={onSaveSettings} /></div><section className="panel tools-panel"><div className="panel-heading"><div><h2>Backup and export</h2></div></div><p className="muted">Backups contain personal and money records. Keep them somewhere private.</p><div className="tool-actions"><button className="button button-secondary" type="button" onClick={onBackup}>Download backup</button><button className="button button-secondary" type="button" onClick={onCsv}>Export CSV</button><label className="button button-secondary file-button">Restore backup<input type="file" accept="application/json,.json" onChange={(event) => void onRestore(event)} /></label></div><p className="fine-print">Restore replaces all current records after you confirm.</p></section></section>;
}

function RewardRow({ data, reward, saving, onPay }: { data: AppData; reward: Reward; saving: boolean; onPay: () => void }) {
  const loan = data.loans.find((item) => item.id === reward.loanId);
  return <div className="reward-row"><span className="avatar">{reward.guarantorName.slice(0, 1).toUpperCase()}</span><div className="reward-main"><strong>{reward.guarantorName}</strong><small>{borrowerName(data, reward.borrowerId)} · {loan ? `Loan due ${formatDate(loan.dueDate)}` : "Loan unavailable"}</small></div><div className="reward-side"><strong>{formatMoney(reward.amountCentavos)}</strong>{reward.state === "pending" ? <button className="button button-small button-primary" type="button" disabled={saving} onClick={onPay}>Mark paid</button> : <span className="status status-paid">Paid {formatDate(reward.paidDate)}</span>}</div></div>;
}

function SettingsPanel({ data, saving, onSave }: { data: AppData; saving: boolean; onSave: (settings: AppSettings) => Promise<void> }) {
  const [form, setForm] = useState({ principal: moneyInputValue(data.settings.defaultPrincipalCentavos), total: moneyInputValue(data.settings.defaultTotalDueCentavos), term: String(data.settings.defaultTermDays), reward: moneyInputValue(data.settings.defaultRewardCentavos) });
  const [error, setError] = useState("");
  useEffect(() => setForm({ principal: moneyInputValue(data.settings.defaultPrincipalCentavos), total: moneyInputValue(data.settings.defaultTotalDueCentavos), term: String(data.settings.defaultTermDays), reward: moneyInputValue(data.settings.defaultRewardCentavos) }), [data.settings]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { const settings = { defaultPrincipalCentavos: parseMoney(form.principal), defaultTotalDueCentavos: parseMoney(form.total), defaultTermDays: Number(form.term), defaultRewardCentavos: parseMoney(form.reward) }; if (!Number.isInteger(settings.defaultTermDays) || settings.defaultTermDays <= 0) throw new Error("Term must be a positive whole number."); if (settings.defaultTotalDueCentavos < settings.defaultPrincipalCentavos) throw new Error("Default total due must be at least the principal."); await onSave(settings); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save defaults."); }
  }
  return <section className="panel"><div className="panel-heading"><div><h2>New loan defaults</h2></div></div><p className="muted">These fill in new loans. You can change them each time.</p><form className="stack compact-form" onSubmit={submit}><div className="form-grid"><label>Principal<input inputMode="decimal" value={form.principal} onChange={(event) => setForm({ ...form, principal: event.target.value })} /></label><label>Total due<input inputMode="decimal" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} /></label><label>Term (days)<input type="number" min="1" value={form.term} onChange={(event) => setForm({ ...form, term: event.target.value })} /></label><label>Reward<input inputMode="decimal" value={form.reward} onChange={(event) => setForm({ ...form, reward: event.target.value })} /></label></div>{error && <ErrorText>{error}</ErrorText>}<button className="button button-secondary" type="submit" disabled={saving}>Save defaults</button></form></section>;
}

function BorrowerForm({ data, borrowerId, saving, commit, onClose, onProfile }: { data: AppData; borrowerId?: string; saving: boolean; commit: (next: AppData) => Promise<void>; onClose: () => void; onProfile: (id: string) => void }) {
  const borrower = data.borrowers.find((item) => item.id === borrowerId);
  const [form, setForm] = useState({ fullName: borrower?.fullName ?? "", phone: borrower?.phone ?? "", area: borrower?.area ?? "", notes: borrower?.notes ?? "" });
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<Borrower[]>([]);
  async function submit(event: FormEvent, force = false) {
    event.preventDefault(); setError("");
    if (!force && !borrower) { const matches = likelyDuplicateBorrowers(data, form.fullName, form.phone); if (matches.length) { setDuplicate(matches); return; } }
    try { const next = borrower ? updateBorrower(data, borrower.id, form) : addBorrower(data, form); await commit(next); onClose(); if (!borrower) onProfile(next.borrowers[next.borrowers.length - 1].id); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save borrower."); }
  }
  return <Modal title={borrower ? "Edit borrower" : "Add borrower"} onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}><label>Full name<input autoFocus value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required /></label><div className="form-grid"><label>Phone <span className="field-hint">optional</span><input type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label><label>Area <span className="field-hint">optional</span><input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} /></label></div><label>Notes <span className="field-hint">optional</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>{duplicate.length > 0 && <div className="warning-box"><strong>Possible duplicate</strong><p>{duplicate.map((item) => item.fullName).join(", ")} matches this name or phone number.</p><button className="button button-secondary" type="button" onClick={(event) => void submit(event, true)}>Save as a different person</button></div>}{error && <ErrorText>{error}</ErrorText>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : borrower ? "Save changes" : "Create borrower"}</button></div></form></Modal>;
}

function LoanForm({ data, borrowerId, priorLoanId, saving, commit, onClose }: { data: AppData; borrowerId?: string; priorLoanId?: string; saving: boolean; commit: (next: AppData) => Promise<void>; onClose: () => void }) {
  const priorLoan = priorLoanId ? data.loans.find((loan) => loan.id === priorLoanId) : undefined;
  const startDate = todayLocal();
  const termDays = priorLoan?.termDays ?? data.settings.defaultTermDays;
  const [form, setForm] = useState({ borrowerId: borrowerId ?? priorLoan?.borrowerId ?? "", principal: moneyInputValue(priorLoan?.principalCentavos ?? data.settings.defaultPrincipalCentavos), total: moneyInputValue(priorLoan?.totalDueCentavos ?? data.settings.defaultTotalDueCentavos), startDate, dueDate: addDays(startDate, termDays), term: String(termDays), guarantorName: "", reward: moneyInputValue(data.settings.defaultRewardCentavos), notes: "" });
  const [dueTouched, setDueTouched] = useState(false);
  const [error, setError] = useState("");
  function updateDateOrTerm(key: "startDate" | "term", value: string) { setForm((current) => { const next = { ...current, [key]: value }; if (!dueTouched) next.dueDate = addDays(next.startDate, Number(next.term) || 0); return next; }); }
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); try { const next = createLoan(data, { borrowerId: form.borrowerId, principalCentavos: parseMoney(form.principal), totalDueCentavos: parseMoney(form.total), startDate: form.startDate, dueDate: form.dueDate, termDays: Number(form.term), notes: form.notes, guarantorName: form.guarantorName, guarantorPhone: "", rewardCentavos: form.guarantorName.trim() ? parseMoney(form.reward) : undefined, priorLoanId }).data; await commit(next); onClose(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not create loan."); } }
  return <Modal title={priorLoan ? "Renew loan" : "New loan"} onClose={onClose} wide><form className="stack" onSubmit={(event) => void submit(event)}><label>Borrower<select value={form.borrowerId} onChange={(event) => setForm({ ...form, borrowerId: event.target.value })} required><option value="">Select borrower</option>{data.borrowers.map((borrower) => <option key={borrower.id} value={borrower.id}>{borrower.fullName}{borrower.phone ? ` · ${borrower.phone}` : ""}</option>)}</select></label><div className="form-grid"><label>Principal<input inputMode="decimal" value={form.principal} onChange={(event) => setForm({ ...form, principal: event.target.value })} required /></label><label>Total due<input inputMode="decimal" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} required /><span className="field-hint">Extra charge: {(() => { try { return formatMoney(Math.max(0, parseMoney(form.total) - parseMoney(form.principal))); } catch { return "—"; } })()}</span></label><label>Start date<input type="date" value={form.startDate} onChange={(event) => updateDateOrTerm("startDate", event.target.value)} required /></label><label>Term (days)<input type="number" min="1" value={form.term} onChange={(event) => updateDateOrTerm("term", event.target.value)} required /></label><label>Due date <span className="field-hint">check the suggested date</span><input type="date" value={form.dueDate} onChange={(event) => { setDueTouched(true); setForm({ ...form, dueDate: event.target.value }); }} required /></label></div><div className="subheading">Guarantor <span className="field-hint">optional</span></div><div className="form-grid"><label>Name<input value={form.guarantorName} onChange={(event) => setForm({ ...form, guarantorName: event.target.value })} /></label><label>Reward amount<input inputMode="decimal" value={form.reward} onChange={(event) => setForm({ ...form, reward: event.target.value })} disabled={!form.guarantorName.trim()} /></label></div><label>Notes <span className="field-hint">optional</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>{priorLoan && <div className="info-box">This creates a new loan linked to the old one. The old loan and its payment history stay unchanged.</div>}{error && <ErrorText>{error}</ErrorText>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save as pending release"}</button></div></form></Modal>;
}

function PaymentForm({ data, loanId, saving, commit, onClose }: { data: AppData; loanId?: string; saving: boolean; commit: (next: AppData) => Promise<void>; onClose: () => void }) {
  const activeLoans = data.loans.filter((loan) => loan.state === "active").sort((a, b) => borrowerName(data, a.borrowerId).localeCompare(borrowerName(data, b.borrowerId)));
  const [form, setForm] = useState({ loanId: loanId ?? activeLoans[0]?.id ?? "", amount: "", receivedDate: todayLocal(), note: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [proofImage, setProofImage] = useState<string>();
  const [proofError, setProofError] = useState("");
  const selected = data.loans.find((loan) => loan.id === form.loanId);
  const balance = selected ? getLoanBalance(data, selected.id) : 0;
  let projected = "—";
  try { if (form.amount) projected = formatMoney(Math.max(0, balance - parseMoney(form.amount))); } catch { projected = "—"; }
  function selectProofImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setProofError("");
    if (!file.type.startsWith("image/")) { setProofError("Choose an image file."); return; }
    // shortcut: proof images are kept in the ledger JSON for the MVP; move them to Supabase Storage when image volume grows.
    if (file.size > 4_000_000) { setProofError("Choose an image smaller than 4 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setProofImage(reader.result); };
    reader.onerror = () => setProofError("That image could not be read.");
    reader.readAsDataURL(file);
  }
  async function submit(event: FormEvent) { event.preventDefault(); if (submitting || saving) return; setError(""); setSubmitting(true); try { await commit(recordPayment(data, { loanId: form.loanId, amountCentavos: parseMoney(form.amount), receivedDate: form.receivedDate, note: form.note, proofImageDataUrl: proofImage })); onClose(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not record payment."); } finally { setSubmitting(false); } }
  return <Modal title="Record payment" onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}>{activeLoans.length ? <><label>Loan<select value={form.loanId} onChange={(event) => setForm({ ...form, loanId: event.target.value })} required><option value="">Select active loan</option>{activeLoans.map((loan) => <option key={loan.id} value={loan.id}>{borrowerName(data, loan.borrowerId)} · {formatMoney(getLoanBalance(data, loan.id))} remaining</option>)}</select></label><div className="balance-preview"><span>Current balance<strong>{formatMoney(balance)}</strong></span><span>After this payment<strong>{projected}</strong></span></div><div className="form-grid"><label>Amount<input autoFocus inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><label>Date received<input type="date" value={form.receivedDate} onChange={(event) => setForm({ ...form, receivedDate: event.target.value })} required /></label></div><label>Note <span className="field-hint">optional</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label><label>Proof image <span className="field-hint">optional</span><input type="file" accept="image/*" capture="environment" onChange={selectProofImage} /></label>{proofImage && <div className="proof-preview"><img src={proofImage} alt="Payment proof preview" /><button className="button button-small button-quiet" type="button" onClick={() => setProofImage(undefined)}>Remove image</button></div>}{proofError && <ErrorText>{proofError}</ErrorText>}</> : <EmptyState title="No active loans">Release a pending loan before recording a payment.</EmptyState>}{error && <ErrorText>{error}</ErrorText>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>{activeLoans.length > 0 && <button className="button button-primary" type="submit" disabled={saving || submitting}>{saving || submitting ? "Saving…" : "Save payment"}</button>}</div></form></Modal>;
}

function ReleaseForm({ data, loanId, saving, commit, onClose }: { data: AppData; loanId: string; saving: boolean; commit: (next: AppData) => Promise<void>; onClose: () => void }) {
  const loan = getLoan(data, loanId);
  const [form, setForm] = useState({ amount: moneyInputValue(loan.principalCentavos), date: todayLocal(), note: "" });
  const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); try { await commit(releaseLoan(data, loan.id, parseMoney(form.amount), form.date, form.note)); onClose(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not release loan."); } }
  return <Modal title="Confirm cash release" onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}><div className="info-box">Principal for this loan: <strong>{formatMoney(loan.principalCentavos)}</strong>. The loan becomes active only after you confirm the cash handover.</div><div className="form-grid"><label>Amount actually released<input autoFocus inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label><label>Release date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label></div><label>Note {form.amount !== moneyInputValue(loan.principalCentavos) && <span className="field-hint">required when amount differs</span>}<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>{error && <ErrorText>{error}</ErrorText>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Confirm release"}</button></div></form></Modal>;
}

function ReverseForm({ data, paymentId, saving, commit, onClose }: { data: AppData; paymentId: string; saving: boolean; commit: (next: AppData) => Promise<void>; onClose: () => void }) {
  const payment = data.payments.find((item) => item.id === paymentId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!payment) return null;
  const original = payment;
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); try { await commit(reversePayment(data, original.id, reason)); onClose(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not reverse payment."); } }
  return <Modal title="Fix payment" onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}><div className="warning-box">The original {formatMoney(original.amountCentavos)} payment stays in the history. An opposite entry will be added. Add a new payment afterward if needed.</div><label>Why are you fixing it?<textarea autoFocus rows={4} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>{error && <ErrorText>{error}</ErrorText>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-danger" type="submit" disabled={saving}>{saving ? "Saving…" : "Fix payment"}</button></div></form></Modal>;
}

function VoidForm({ data, loanId, saving, commit, onClose }: { data: AppData; loanId: string; saving: boolean; commit: (next: AppData) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setError(""); try { await commit(voidLoan(data, loanId, reason)); onClose(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not void loan."); } }
  return <Modal title="Cancel pending loan" onClose={onClose}><form className="stack" onSubmit={(event) => void submit(event)}><p>This is only available before cash release. The loan stays in the records with the reason.</p><label>Why are you cancelling it?<textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} required /></label>{error && <ErrorText>{error}</ErrorText>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-danger" type="submit" disabled={saving}>{saving ? "Saving…" : "Cancel loan"}</button></div></form></Modal>;
}

function LoanDetail({ data, loanId, onClose, onPay, onRelease, onReverse, onVoid, onRenew, onOpenLoan }: { data: AppData; loanId: string; onClose: () => void; onPay: (id: string) => void; onRelease: (id: string) => void; onReverse: (id: string) => void; onVoid: (id: string) => void; onRenew: (id: string) => void; onOpenLoan: (id: string) => void }) {
  const loan = data.loans.find((item) => item.id === loanId);
  if (!loan) return null;
  const status = loanDisplayStatus(data, loan);
  const payments = getLoanPayments(data, loan.id);
  return <Modal title="Loan details" onClose={onClose} wide><div className="detail-header"><div><p className="detail-name">{borrowerName(data, loan.borrowerId)}</p><h2 className="detail-balance">{formatMoney(getLoanBalance(data, loan.id))}</h2><p className="muted">unpaid balance</p></div><StatusChip status={status} /></div><div className="detail-grid"><div><span>Principal</span><strong>{formatMoney(loan.principalCentavos)}</strong></div><div><span>Total due</span><strong>{formatMoney(loan.totalDueCentavos)}</strong></div><div><span>Released</span><strong>{loan.releaseAmountCentavos === undefined ? "Not yet" : formatMoney(loan.releaseAmountCentavos)}</strong></div><div><span>Due date</span><strong>{formatDate(loan.dueDate)}</strong></div></div><div className="detail-actions">{loan.state === "pending_release" && <><button className="button button-primary" type="button" onClick={() => onRelease(loan.id)}>Confirm release</button><button className="button button-secondary" type="button" onClick={() => onVoid(loan.id)}>Cancel loan</button></>}{loan.state === "active" && <button className="button button-primary" type="button" onClick={() => onPay(loan.id)}>＋ Record payment</button>}{(loan.state === "paid" || loan.state === "active") && <button className="button button-secondary" type="button" onClick={() => onRenew(loan.id)}>Renew loan</button>}</div>{loan.priorLoanId && <div className="info-box">Renewed from <button className="text-button" type="button" onClick={() => onOpenLoan(loan.priorLoanId!)}>prior loan</button>.</div>}{loan.guarantorName && <div className="note-box"><strong>Guarantor</strong><p className="highlight-name">{loan.guarantorName}</p>{loan.guarantorPhone && <p>{loan.guarantorPhone}</p>}</div>}{loan.notes && <div className="note-box"><strong>Loan notes</strong><p>{loan.notes}</p></div>}<div className="detail-history"><div className="panel-heading"><div><h3>Payment history</h3></div><span className="count-badge">{payments.length} payment record{payments.length === 1 ? "" : "s"}</span></div>{payments.map((payment) => { const reversed = payment.kind === "payment" && isPaymentReversed(data, payment.id); return <div className="payment-row" key={payment.id}><span className={`activity-dot ${payment.kind === "reversal" ? "reversal-dot" : ""}`}>{payment.kind === "reversal" ? "↶" : "₱"}</span><div className="payment-main"><strong className="payment-date">{formatDate(payment.receivedDate)} {reversed && <span className="inline-label">corrected</span>}</strong><small>{payment.kind === "reversal" ? "Correction" : payment.note}</small></div><div className={`payment-amount ${payment.amountCentavos < 0 ? "negative" : ""}`}>{payment.amountCentavos < 0 ? "−" : "+"}{formatMoney(Math.abs(payment.amountCentavos))}</div>{payment.proofImageDataUrl && <a className="proof-link" href={payment.proofImageDataUrl} target="_blank" rel="noreferrer" aria-label="Open payment proof"><img src={payment.proofImageDataUrl} alt="Payment proof" /></a>}{payment.kind === "payment" && !reversed && <button className="button button-small button-quiet" type="button" onClick={() => onReverse(payment.id)}>Fix</button>}</div>; })}{!payments.length && <p className="muted panel-empty">No payments recorded yet.</p>}</div></Modal>;
}

export default App;
