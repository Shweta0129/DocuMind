import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "../lib/api";
import { AuthShell, Field } from "./Login";
import { LOGIN } from "../constants/testIds/auth";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.forgotPassword(email);
      setSent(true);
      toast.success(r.message || "Check your email");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a reset link">
      {sent ? (
        <p className="text-sm">
          If an account exists for <b>{email}</b>, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form className="space-y-4" onSubmit={submit} data-testid="forgot-form">
          <Field label="Work email">
            <input type="email" className="nb-input" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid={LOGIN.emailInput} />
          </Field>
          <button type="submit" className="nb-btn w-full justify-center" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="text-sm text-center text-[var(--muted)] mt-6">
        <Link to="/login" className="font-bold underline">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
