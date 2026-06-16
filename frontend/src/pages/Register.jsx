import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import GoogleButton from "../components/GoogleButton";
import { AuthShell, Field } from "./Login";
import { REGISTER } from "../constants/testIds/auth";

export default function Register() {
  const { register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", company_name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const errMsg = (e) => e?.response?.data?.detail || "Could not create your account.";

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters");
    if (form.password !== form.confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await register({
        name: form.name,
        company_name: form.company_name,
        email: form.email,
        password: form.password,
      });
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async (credential) => {
    setBusy(true);
    try {
      await googleLogin(credential, form.company_name);
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your workspace" subtitle="Your company's documents stay private to your workspace">
      <form className="space-y-4" onSubmit={submit} data-testid="register-form">
        <Field label="Your name">
          <input className="nb-input" value={form.name} onChange={set("name")} required data-testid={REGISTER.nameInput} />
        </Field>
        <Field label="Company / workspace name">
          <input className="nb-input" value={form.company_name} onChange={set("company_name")} placeholder="Acme Inc." data-testid="register-company-input" />
        </Field>
        <Field label="Work email">
          <input type="email" className="nb-input" value={form.email} onChange={set("email")} required autoComplete="email" data-testid={REGISTER.emailInput} />
        </Field>
        <Field label="Password">
          <input type="password" className="nb-input" value={form.password} onChange={set("password")} required autoComplete="new-password" data-testid={REGISTER.passwordInput} />
        </Field>
        <Field label="Confirm password">
          <input type="password" className="nb-input" value={form.confirm} onChange={set("confirm")} required autoComplete="new-password" data-testid={REGISTER.passwordConfirmInput} />
        </Field>
        <button type="submit" className="nb-btn w-full justify-center" disabled={busy} data-testid={REGISTER.submitButton}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>

      <div className="flex items-center gap-3 my-5">
        <div className="h-px flex-1 bg-[var(--ink)] opacity-20" />
        <span className="text-xs uppercase tracking-widest text-[var(--muted)]">or</span>
        <div className="h-px flex-1 bg-[var(--ink)] opacity-20" />
      </div>
      <GoogleButton onCredential={onGoogle} />

      <p className="text-sm text-center text-[var(--muted)] mt-6">
        Already have an account?{" "}
        <Link to="/login" className="font-bold underline" data-testid={REGISTER.loginLink}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
