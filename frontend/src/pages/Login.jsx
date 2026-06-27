import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { apiError } from "../lib/api";
import GoogleButton from "../components/GoogleButton";
import { LOGIN } from "../constants/testIds/auth";

export default function Login() {
  const { login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const errMsg = (e) => apiError(e, "Something went wrong. Please try again.");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
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
      await googleLogin(credential);
      navigate("/");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your DocuMind workspace">
      <form className="space-y-4" onSubmit={submit} data-testid="login-form">
        <Field label="Work email">
          <input
            type="email"
            className="nb-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            data-testid={LOGIN.emailInput}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            className="nb-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            data-testid={LOGIN.passwordInput}
          />
        </Field>
        <div className="text-right -mt-1">
          <Link to="/forgot-password" className="text-xs text-[var(--muted)] underline" data-testid={LOGIN.forgotPasswordLink}>
            Forgot password?
          </Link>
        </div>
        <button type="submit" className="nb-btn w-full justify-center" disabled={busy} data-testid={LOGIN.submitButton}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <GoogleDivider />
      <GoogleButton onCredential={onGoogle} />

      <p className="text-sm text-center text-[var(--muted)] mt-6">
        New here?{" "}
        <Link to="/register" className="font-bold underline" data-testid={LOGIN.registerLink}>
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10 bg-[var(--paper)]">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="w-10 h-10 rounded-lg bg-[var(--primary)] border-2 border-[var(--ink)] flex items-center justify-center shadow-[3px_3px_0_0_var(--ink)]">
            <Sparkles className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <span className="font-black text-xl tracking-tight" style={{ fontFamily: "Outfit" }}>
            DocuMind <span className="text-[var(--muted)]">AI</span>
          </span>
        </div>
        <div className="nb-card p-6 md:p-8">
          <h1 className="text-2xl font-black tracking-tight mb-1" style={{ fontFamily: "Outfit" }}>{title}</h1>
          <p className="text-sm text-[var(--muted)] mb-6">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <div>
      <label className="label-eyebrow block mb-1">{label}</label>
      {children}
    </div>
  );
}

function GoogleDivider() {
  return (
    <div className="flex items-center gap-3 my-5">
      <div className="h-px flex-1 bg-[var(--ink)] opacity-20" />
      <span className="text-xs uppercase tracking-widest text-[var(--muted)]">or</span>
      <div className="h-px flex-1 bg-[var(--ink)] opacity-20" />
    </div>
  );
}
