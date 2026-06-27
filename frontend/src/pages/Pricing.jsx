import { useEffect, useState } from "react";
import { api, apiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { Check, Sparkles, Crown } from "lucide-react";

function loadRazorpay() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const rupees = (paise) => (paise == null ? null : `₹${(paise / 100).toLocaleString("en-IN")}`);

export default function Pricing() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [sub, setSub] = useState(null);
  const [busy, setBusy] = useState("");

  const refresh = () => api.subscription().then(setSub).catch(() => {});
  useEffect(() => {
    api.billingPlans().then((d) => setPlans(d.plans)).catch(() => {});
    refresh();
  }, []);

  const upgrade = async (plan) => {
    if (plan.contact) {
      window.location.href = `mailto:${user?.email || "sales@documind.ai"}?subject=DocuMind%20Enterprise%20enquiry`;
      return;
    }
    if (!plan.checkout) return;
    setBusy(plan.id);
    try {
      const ok = await loadRazorpay();
      if (!ok) return toast.error("Could not load the payment SDK. Check your connection.");
      const order = await api.checkout(plan.id);
      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: "DocuMind AI",
        description: order.plan.name,
        order_id: order.order_id,
        prefill: { email: user?.email, name: user?.name },
        theme: { color: "#FFE45E" },
        handler: async (resp) => {
          try {
            await api.verifyPayment({
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
              plan_id: plan.id,
            });
            toast.success("Subscription active 🎉");
            refresh();
          } catch {
            toast.error("Payment captured but verification failed — contact support.");
          }
        },
      });
      rzp.on("payment.failed", () => toast.error("Payment failed or cancelled."));
      rzp.open();
    } catch (e) {
      toast.error(apiError(e, "Could not start checkout."));
    } finally {
      setBusy("");
    }
  };

  const ent = sub?.entitlement;
  const cur = sub?.subscription;

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-6xl mx-auto" data-testid="pricing-page">
      <div className="label-eyebrow flex items-center gap-1.5"><Crown className="w-3.5 h-3.5" /> Plans</div>
      <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "Outfit" }}>
        Simple pricing for serious documents
      </h1>

      {/* Current status */}
      {sub && (
        <div className="nb-card p-4 mt-5 bg-[var(--paper)]" data-testid="subscription-status">
          {ent?.reason === "active" ? (
            <p className="text-sm">
              <b>Active — {plans.find((p) => p.id === cur?.plan)?.name || cur?.plan}</b>. Renews/expires {new Date(cur?.current_period_end).toLocaleDateString()}.
            </p>
          ) : ent?.reason === "trial" ? (
            <p className="text-sm">
              <b>Free trial:</b> {ent.trial_days_left} day(s) and {ent.trial_docs_left} document(s) left. Upgrade any time.
            </p>
          ) : (
            <p className="text-sm text-red-600 font-semibold">Your free trial has ended — choose a plan to keep generating.</p>
          )}
        </div>
      )}

      {/* Plans */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-6">
        {plans.map((plan) => {
          const isCurrent = cur?.plan === plan.id && ent?.reason === "active";
          return (
            <div key={plan.id} className="nb-card p-5 flex flex-col" data-testid={`plan-${plan.id}`}>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black" style={{ fontFamily: "Outfit" }}>{plan.name}</h3>
                {plan.id === "pro_yearly" && <span className="nb-chip" style={{ background: "var(--primary)" }}>Best value</span>}
              </div>
              <div className="mt-2 mb-1">
                {plan.price_paise == null ? (
                  <span className="text-2xl font-black">Custom</span>
                ) : plan.price_paise === 0 ? (
                  <span className="text-2xl font-black">Free</span>
                ) : (
                  <span className="text-3xl font-black">{rupees(plan.price_paise)}<span className="text-sm font-medium text-[var(--muted)]">/{plan.period_label}</span></span>
                )}
              </div>
              <p className="text-sm text-[var(--muted)] mb-4">{plan.blurb}</p>
              <div className="flex-1" />
              {isCurrent ? (
                <button className="nb-btn nb-btn-ghost w-full justify-center" disabled>
                  <Check className="w-4 h-4" /> Current plan
                </button>
              ) : plan.contact ? (
                <button className="nb-btn nb-btn-ghost w-full justify-center" onClick={() => upgrade(plan)} data-testid={`select-${plan.id}`}>
                  Contact sales
                </button>
              ) : plan.checkout ? (
                <button className="nb-btn w-full justify-center" disabled={busy === plan.id} onClick={() => upgrade(plan)} data-testid={`select-${plan.id}`}>
                  <Sparkles className="w-4 h-4" /> {busy === plan.id ? "Starting…" : "Choose " + plan.name}
                </button>
              ) : (
                <button className="nb-btn nb-btn-ghost w-full justify-center" disabled>Included</button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[var(--muted)] mt-6">
        Payments are processed securely by Razorpay. Prices in INR. You can change plans anytime.
      </p>
    </div>
  );
}
