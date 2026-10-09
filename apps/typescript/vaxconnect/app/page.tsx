
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // dummy/local auth for now — swap for real backend later
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-3xl mb-2">💉</div>
          <h1 className="font-display text-3xl text-ink">VaxConnect</h1>
          <p className="text-ink/60 text-sm mt-1">Vaccination guidance made simple.</p>
        </div>

        <div className="border border-line bg-white/40 rounded-md p-7">
          <div className="flex mb-6 text-sm font-medium border-b border-line">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 pb-3 border-b-2 -mb-px transition-colors ${
                  mode === m ? "border-teal text-ink" : "border-transparent text-ink/45"
                }`}
              >
                {m === "login" ? "Login" : "Sign Up"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Field label="Email" type="email" />
            <Field label="Password" type="password" />
            {mode === "signup" && <Field label="Confirm Password" type="password" />}
            <button
              type="submit"
              className="mt-2 bg-teal text-paper rounded-md py-2.5 text-sm font-medium hover:bg-teal-dark transition-colors"
            >
              {mode === "login" ? "Login" : "Create Account"}
            </button>
          </form>

          <p className="text-center text-xs text-ink/50 mt-5">
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => setMode(mode === "login" ? "signup" : "login")} className="text-teal font-medium">
              {mode === "login" ? "Sign Up" : "Login"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, type }: { label: string; type: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-ink/70">{label}</span>
      <input
        type={type}
        required
        className="border border-line rounded-md px-3 py-2 bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
      />
    </label>
  );
}