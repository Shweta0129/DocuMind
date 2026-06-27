import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, apiError } from "../lib/api";
import { AuthShell, Field } from "./Login";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const r = await api.resetPassword(token, pw);
      toast.success(r.message || "Password updated");
      navigate("/login");
    } catch (err) {
      toast.error(apiError(err, "Could not reset password"));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Invalid link" subtitle="This reset link is missing or broken">
        <p className="text-sm">
          <Link to="/forgot-password" className="font-bold underline">Request a new reset link</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a strong password">
      <form className="space-y-4" onSubmit={submit} data-testid="reset-form">
        <Field label="New password">
          <input type="password" className="nb-input" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm password">
          <input type="password" className="nb-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <button type="submit" className="nb-btn w-full justify-center" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </AuthShell>
  );
}
