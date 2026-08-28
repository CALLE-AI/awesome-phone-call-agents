"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { authClient } from "@/auth-client";

export type AuthView = "sign-in" | "sign-up";
type SignInMethod = "password" | "email-code";
type SignupField = "name" | "email" | "password";
type SignupFieldErrors = Partial<Record<SignupField, string>>;
const pendingVerificationEmailKey = "fieldclose.pending-verification-email";
const signupFieldOrder: SignupField[] = [
  "name",
  "email",
  "password",
];
const signupFieldLabels: Record<SignupField, string> = {
  name: "Your name",
  email: "Work email",
  password: "Password",
};
const signupFieldIds: Record<SignupField, string> = {
  name: "signup-name",
  email: "signup-email",
  password: "signup-password",
};
const accountServiceUnavailableMessage =
  "The account service is temporarily unavailable. Your details are still in the form; try again in a moment.";

type SignInScreenProps = {
  initialView?: AuthView;
  returnTo?: string;
};

export function SignInScreen({
  initialView = "sign-in",
  returnTo = "/workspace",
}: SignInScreenProps) {
  const [view, setView] = useState<AuthView>(initialView);
  const [method, setMethod] = useState<SignInMethod>("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [name, setName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [verificationEmail, setVerificationEmail] = useState<string | null>(
    null,
  );
  const [verificationCode, setVerificationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signupFieldErrors, setSignupFieldErrors] =
    useState<SignupFieldErrors>({});

  useEffect(() => {
    const pendingEmail = window.sessionStorage.getItem(
      pendingVerificationEmailKey,
    );

    if (!pendingEmail) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setView("sign-up");
      setVerificationEmail(pendingEmail);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function selectView(nextView: AuthView) {
    setView(nextView);
    forgetVerificationEmail();
    setVerificationCode("");
    setSignupFieldErrors({});
    clearFeedback();
  }

  function selectMethod(nextMethod: SignInMethod) {
    setMethod(nextMethod);
    setCodeSent(false);
    setCode("");
    clearFeedback();
  }

  function handleViewTabKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    const nextView =
      event.key === "ArrowLeft" || event.key === "Home"
        ? "sign-in"
        : event.key === "ArrowRight" || event.key === "End"
          ? "sign-up"
          : null;

    if (!nextView) {
      return;
    }

    event.preventDefault();
    selectView(nextView);
    document.getElementById(`auth-${nextView}-tab`)?.focus();
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);

    const normalizedIdentifier = identifier.trim();
    try {
      const response = normalizedIdentifier.includes("@")
        ? await authClient.signIn.email({
            email: normalizedIdentifier,
            password,
            rememberMe,
            callbackURL: returnTo,
          })
        : await authClient.signIn.username({
            username: normalizedIdentifier,
            password,
            rememberMe,
            callbackURL: returnTo,
          });

      if (response.error) {
        if (
          response.error.code === "EMAIL_NOT_VERIFIED" &&
          normalizedIdentifier.includes("@")
        ) {
          rememberVerificationEmail(normalizedIdentifier);
          setNotice(
            "Your password is correct. Enter the code sent to your email to finish verification.",
          );
          return;
        }

        setError(
          authErrorMessage(
            response.error,
            "The email, username, or password did not match.",
          ),
        );
        return;
      }

      window.location.assign(returnTo);
    } catch {
      setError(accountServiceUnavailableMessage);
    } finally {
      setBusy(false);
    }
  }

  async function requestEmailCode(event: React.FormEvent) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);

    const normalizedEmail = email.trim();
    const response = await authClient.emailOtp.sendVerificationOtp({
      email: normalizedEmail,
      type: "sign-in",
    });

    setBusy(false);

    if (response.error) {
      setError(
        authErrorMessage(
          response.error,
          "We could not send a code. Check the address and try again.",
        ),
      );
      return;
    }

    setEmail(normalizedEmail);
    setCodeSent(true);
    setNotice(
      "If this email belongs to an account, a six-digit code is on its way.",
    );
  }

  async function signInWithEmailCode(event: React.FormEvent) {
    event.preventDefault();
    clearFeedback();
    setBusy(true);

    const response = await authClient.signIn.emailOtp({
      email: email.trim(),
      otp: code.trim(),
    });

    setBusy(false);

    if (response.error) {
      setError(
        authErrorMessage(
          response.error,
          "The code is invalid or expired. Request a new code.",
        ),
      );
      return;
    }

    window.location.assign(returnTo);
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    clearFeedback();

    const normalizedName = name.trim();
    const normalizedEmail = signupEmail.trim();
    const fieldErrors = validateSignupFields({
      name: normalizedName,
      email: normalizedEmail,
      password: signupPassword,
    });

    if (Object.keys(fieldErrors).length > 0) {
      setSignupFieldErrors(fieldErrors);
      setError(signupErrorSummary(fieldErrors));
      focusFirstSignupError(fieldErrors);
      return;
    }

    setSignupFieldErrors({});
    setBusy(true);
    rememberVerificationEmail(normalizedEmail);
    const generatedUsername = createGeneratedUsername(normalizedEmail);

    try {
      const response = await authClient.signUp.email({
        name: normalizedName,
        email: normalizedEmail,
        password: signupPassword,
        username: generatedUsername,
        displayUsername: generatedUsername,
        callbackURL: returnTo,
      });

      if (response.error) {
        forgetVerificationEmail();
        const signupError = signupErrorDetails(response.error);
        setSignupFieldErrors(signupError.fields);
        setError(signupError.summary);
        focusFirstSignupError(signupError.fields);
        return;
      }

      setNotice(
        "Enter the six-digit code sent to your email to activate the account.",
      );
    } catch {
      forgetVerificationEmail();
      setError(
        "The account service could not complete this request. Your details are still in the form; try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyAccount(event: React.FormEvent) {
    event.preventDefault();
    clearFeedback();

    if (!verificationEmail) {
      return;
    }

    setBusy(true);
    const response = await authClient.emailOtp.verifyEmail({
      email: verificationEmail,
      otp: verificationCode.trim(),
    });
    setBusy(false);

    if (response.error) {
      setError(
        authErrorMessage(
          response.error,
          "The code is invalid or expired. Request a new code.",
        ),
      );
      return;
    }

    forgetVerificationEmail();
    window.location.assign(returnTo);
  }

  async function resendVerificationCode() {
    clearFeedback();

    if (!verificationEmail) {
      return;
    }

    setBusy(true);
    const response = await authClient.emailOtp.sendVerificationOtp({
      email: verificationEmail,
      type: "email-verification",
    });
    setBusy(false);

    if (response.error) {
      setError(
        authErrorMessage(
          response.error,
          "We could not send a new code. Wait a moment and try again.",
        ),
      );
      return;
    }

    setVerificationCode("");
    setNotice("A new six-digit verification code is on its way.");
  }

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  function updateSignupField(
    field: SignupField,
    value: string,
    updateValue: (nextValue: string) => void,
  ) {
    updateValue(value);

    if (!signupFieldErrors[field]) {
      return;
    }

    const nextErrors = { ...signupFieldErrors };
    delete nextErrors[field];
    setSignupFieldErrors(nextErrors);
    setError(
      Object.keys(nextErrors).length > 0
        ? signupErrorSummary(nextErrors)
        : null,
    );
  }

  function rememberVerificationEmail(pendingEmail: string) {
    window.sessionStorage.setItem(
      pendingVerificationEmailKey,
      pendingEmail,
    );
    setView("sign-up");
    setVerificationEmail(pendingEmail);
  }

  function forgetVerificationEmail() {
    window.sessionStorage.removeItem(pendingVerificationEmailKey);
    setVerificationEmail(null);
  }

  return (
    <div className="auth-drawer-panel">
      <div className="auth-drawer-heading">
        <div>
          <span className="mode-label">
            <i aria-hidden="true" /> Public demo · fake only
          </span>
          <p>Workspace access</p>
        </div>
        <Link
          aria-label="Close account access"
          className="auth-drawer-close"
          href="/"
        >
          <span aria-hidden="true">×</span>
        </Link>
      </div>

      <section className="signin-shell">
        <div className="signin-panel">
          <header className="signin-intro">
            <h2 id="account-access-title">
              {view === "sign-in" ? "Sign in to FieldClose" : "Create your demo workspace"}
            </h2>
            <p>
              {view === "sign-in"
                ? "Access your team’s closeout workspace."
                : "Use fictional data to explore one human-approved closeout flow."}
            </p>
          </header>
          <section className="signin-auth" aria-label="FieldClose account access">
            <div
              aria-label="Account action"
              className="auth-view-tabs"
              data-active-view={view}
              role="tablist"
            >
              <button
                aria-controls="auth-view-panel"
                aria-selected={view === "sign-in"}
                id="auth-sign-in-tab"
                onClick={() => selectView("sign-in")}
                onKeyDown={handleViewTabKeyDown}
                role="tab"
                tabIndex={view === "sign-in" ? 0 : -1}
                type="button"
              >
                Sign in
              </button>
              <button
                aria-controls="auth-view-panel"
                aria-selected={view === "sign-up"}
                id="auth-sign-up-tab"
                onClick={() => selectView("sign-up")}
                onKeyDown={handleViewTabKeyDown}
                role="tab"
                tabIndex={view === "sign-up" ? 0 : -1}
                type="button"
              >
                Create workspace
              </button>
            </div>

            <div
              aria-labelledby={
                view === "sign-in" ? "auth-sign-in-tab" : "auth-sign-up-tab"
              }
              id="auth-view-panel"
              role="tabpanel"
            >
              {verificationEmail ? (
                <VerificationForm
                  busy={busy}
                  code={verificationCode}
                  email={verificationEmail}
                  onCodeChange={setVerificationCode}
                  onResend={() => void resendVerificationCode()}
                  onSubmit={verifyAccount}
                  onUseAnotherEmail={() => {
                    forgetVerificationEmail();
                    setVerificationCode("");
                    clearFeedback();
                  }}
                />
              ) : view === "sign-in" ? (
                <>
                  <div
                    aria-label="Sign-in method"
                    className="auth-method-switch"
                    data-active-method={method}
                    role="group"
                  >
                  <button
                    aria-pressed={method === "password"}
                    onClick={() => selectMethod("password")}
                    type="button"
                  >
                    Password
                  </button>
                  <button
                    aria-pressed={method === "email-code"}
                    onClick={() => selectMethod("email-code")}
                    type="button"
                  >
                    Email code
                  </button>
                  </div>

                {method === "password" ? (
                  <form className="auth-form" onSubmit={signInWithPassword}>
                    <AuthField label="Email or username" htmlFor="signin-identifier">
                      <input
                        autoComplete="username"
                        id="signin-identifier"
                        onChange={(event) => setIdentifier(event.target.value)}
                        required
                        value={identifier}
                      />
                    </AuthField>
                    <AuthField label="Password" htmlFor="signin-password">
                      <input
                        autoComplete="current-password"
                        id="signin-password"
                        maxLength={128}
                        minLength={8}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        type="password"
                        value={password}
                      />
                    </AuthField>
                    <label className="auth-remember">
                      <input
                        checked={rememberMe}
                        onChange={(event) => setRememberMe(event.target.checked)}
                        type="checkbox"
                      />
                      <span>Keep me signed in on this device</span>
                    </label>
                    <button
                      aria-busy={busy}
                      className="primary-button full-width"
                      disabled={busy}
                      type="submit"
                    >
                      {busy ? "Signing in…" : "Sign in"}
                    </button>
                  </form>
                ) : codeSent ? (
                  <form className="auth-form" onSubmit={signInWithEmailCode}>
                    <p className="auth-context">
                      Code sent to <strong>{email}</strong>
                    </p>
                    <AuthField label="Six-digit code" htmlFor="signin-code">
                      <input
                        autoComplete="one-time-code"
                        id="signin-code"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) =>
                          setCode(event.target.value.replace(/\D/gu, ""))
                        }
                        pattern="[0-9]{6}"
                        required
                        value={code}
                      />
                    </AuthField>
                    <button
                      aria-busy={busy}
                      className="primary-button full-width"
                      disabled={busy}
                      type="submit"
                    >
                      {busy ? "Verifying…" : "Verify and sign in"}
                    </button>
                    <button
                      className="auth-inline-action"
                      onClick={() => {
                        setCodeSent(false);
                        setCode("");
                        clearFeedback();
                      }}
                      type="button"
                    >
                      Use another email
                    </button>
                  </form>
                ) : (
                  <form className="auth-form" onSubmit={requestEmailCode}>
                    <AuthField label="Work email" htmlFor="code-email">
                      <input
                        autoComplete="email"
                        id="code-email"
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        type="email"
                        value={email}
                      />
                    </AuthField>
                    <button
                      aria-busy={busy}
                      className="primary-button full-width"
                      disabled={busy}
                      type="submit"
                    >
                      {busy ? "Sending code…" : "Send sign-in code"}
                    </button>
                  </form>
                )}
                </>
              ) : (
                <form className="auth-form" noValidate onSubmit={createAccount}>
                  <AuthField
                    error={signupFieldErrors.name}
                    label="Your name"
                    htmlFor="signup-name"
                  >
                    <input
                      aria-describedby={
                        signupFieldErrors.name
                          ? "signup-name-error"
                          : undefined
                      }
                      aria-invalid={
                        signupFieldErrors.name ? "true" : undefined
                      }
                      autoComplete="name"
                      id="signup-name"
                      maxLength={80}
                      minLength={2}
                      onChange={(event) =>
                        updateSignupField(
                          "name",
                          event.target.value,
                          setName,
                        )
                      }
                      required
                      value={name}
                    />
                  </AuthField>
                <AuthField
                  error={signupFieldErrors.email}
                  label="Work email"
                  htmlFor="signup-email"
                >
                  <input
                    aria-describedby={
                      signupFieldErrors.email
                        ? "signup-email-error"
                        : undefined
                    }
                    aria-invalid={
                      signupFieldErrors.email ? "true" : undefined
                    }
                    autoComplete="email"
                    id="signup-email"
                    onChange={(event) =>
                      updateSignupField(
                        "email",
                        event.target.value,
                        setSignupEmail,
                      )
                    }
                    required
                    type="email"
                    value={signupEmail}
                  />
                </AuthField>
                <AuthField
                  error={signupFieldErrors.password}
                  label="Password"
                  htmlFor="signup-password"
                >
                  <input
                    aria-describedby={
                      signupFieldErrors.password
                        ? "signup-password-error"
                        : "signup-password-help"
                    }
                    aria-invalid={
                      signupFieldErrors.password ? "true" : undefined
                    }
                    autoComplete="new-password"
                    id="signup-password"
                    maxLength={128}
                    minLength={8}
                    onChange={(event) =>
                      updateSignupField(
                        "password",
                        event.target.value,
                        setSignupPassword,
                      )
                    }
                    required
                    type="password"
                    value={signupPassword}
                  />
                  <ul
                    aria-label="Password requirements"
                    className="password-requirements"
                    id="signup-password-help"
                  >
                    <li
                      aria-live="polite"
                      data-met={
                        signupPassword.length >= 8 &&
                        signupPassword.length <= 128
                      }
                    >
                      <span aria-hidden="true">✓</span>
                      8–128 characters
                    </li>
                    <li>
                      <span aria-hidden="true">•</span>
                      Do not reuse a work-system password
                    </li>
                  </ul>
                </AuthField>
                <button
                  aria-busy={busy}
                  className="primary-button full-width"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Creating workspace…" : "Create demo workspace"}
                </button>
                <p className="auth-trust-note">
                  <span aria-hidden="true" />
                  Simulation only. No real customer data or calls.
                </p>
                </form>
              )}

              <div
                className="auth-feedback"
                data-visible={Boolean(error || notice)}
              >
                {error ? (
                  <p
                    className="signin-error"
                    role={
                      Object.keys(signupFieldErrors).length > 0
                        ? undefined
                        : "alert"
                    }
                  >
                    {error}
                  </p>
                ) : notice ? (
                  <p className="signin-notice" role="status">
                    {notice}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function VerificationForm({
  busy,
  code,
  email,
  onCodeChange,
  onResend,
  onSubmit,
  onUseAnotherEmail,
}: {
  busy: boolean;
  code: string;
  email: string;
  onCodeChange: (code: string) => void;
  onResend: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onUseAnotherEmail: () => void;
}) {
  return (
    <form className="auth-form auth-verification" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">Verify your email</p>
        <p className="auth-context">
          Enter the code sent to <strong>{email}</strong>.
        </p>
      </div>
      <AuthField label="Six-digit code" htmlFor="verification-code">
        <input
          autoComplete="one-time-code"
          id="verification-code"
          inputMode="numeric"
          maxLength={6}
          onChange={(event) =>
            onCodeChange(event.target.value.replace(/\D/gu, ""))
          }
          pattern="[0-9]{6}"
          required
          value={code}
        />
      </AuthField>
      <button
        aria-busy={busy}
        className="primary-button full-width"
        disabled={busy}
        type="submit"
      >
        {busy ? "Verifying…" : "Verify and continue"}
      </button>
      <div className="auth-secondary-actions">
        <button
          className="auth-inline-action"
          disabled={busy}
          onClick={onResend}
          type="button"
        >
          Resend verification code
        </button>
        <button
          className="auth-inline-action"
          disabled={busy}
          onClick={onUseAnotherEmail}
          type="button"
        >
          Use another email
        </button>
      </div>
    </form>
  );
}

function AuthField({
  children,
  error,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className={`auth-field${error ? " auth-field-invalid" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <small
          className="auth-field-error"
          id={`${htmlFor}-error`}
          role="alert"
        >
          {error}
        </small>
      ) : null}
    </div>
  );
}

function validateSignupFields({
  name,
  email,
  password,
}: {
  name: string;
  email: string;
  password: string;
}): SignupFieldErrors {
  const errors: SignupFieldErrors = {};

  if (name.length < 2 || name.length > 80) {
    errors.name = "Enter your name using 2–80 characters.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (password.length < 8 || password.length > 128) {
    errors.password = "Use 8–128 characters.";
  }

  return errors;
}

function signupErrorDetails(error: {
  code?: string;
  status?: number;
}): {
  fields: SignupFieldErrors;
  summary: string;
} {
  const fields: SignupFieldErrors = {};

  switch (error.code) {
    case "USERNAME_IS_ALREADY_TAKEN":
      fields.email =
        "An account identifier for this email is unavailable. Use another email.";
      break;
    case "INVALID_USERNAME":
      return {
        fields,
        summary:
          "The account service could not generate an account identifier. Try again in a moment.",
      };
    case "INVALID_EMAIL":
      fields.email = "Enter a valid email address.";
      break;
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      fields.email =
        "An account already uses this email. Sign in or use another email.";
      break;
    case "PASSWORD_TOO_SHORT":
      fields.password = "Use at least 8 characters.";
      break;
    case "PASSWORD_TOO_LONG":
      fields.password = "Use no more than 128 characters.";
      break;
  }

  if (Object.keys(fields).length > 0) {
    return {
      fields,
      summary: signupErrorSummary(fields),
    };
  }

  return {
    fields,
    summary:
      error.status === 429
        ? "Too many attempts. Wait a few minutes before trying again."
        : "The account service could not complete this request. Your details are still in the form; try again in a moment.",
  };
}

function signupErrorSummary(errors: SignupFieldErrors) {
  const labels = signupFieldOrder
    .filter((field) => Boolean(errors[field]))
    .map((field) => signupFieldLabels[field]);
  const fieldList =
    labels.length > 2
      ? `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : labels[0];

  return `Fix the highlighted ${
    labels.length === 1 ? "field" : "fields"
  }: ${fieldList}.`;
}

function focusFirstSignupError(errors: SignupFieldErrors) {
  const firstInvalidField = signupFieldOrder.find((field) => errors[field]);

  if (!firstInvalidField) {
    return;
  }

  queueMicrotask(() => {
    document.getElementById(signupFieldIds[firstInvalidField])?.focus();
  });
}

function createGeneratedUsername(email: string) {
  const [localPart = "demo"] = email.toLowerCase().split("@");
  const stem =
    localPart
      .replace(/[^a-z0-9_.]+/gu, "_")
      .replace(/^[._]+|[._]+$/gu, "")
      .slice(0, 20) || "demo";
  let hash = 2166136261;

  for (const character of email.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return `${stem}.${(hash >>> 0).toString(36)}`.slice(0, 30);
}

function authErrorMessage(
  error: { code?: string; status?: number },
  fallback: string,
) {
  if (
    error.status === undefined ||
    error.status >= 500 ||
    error.code === "AUTH_SERVICE_UNAVAILABLE"
  ) {
    return accountServiceUnavailableMessage;
  }

  if (error.status === 429) {
    return "Too many attempts. Wait a few minutes before trying again.";
  }

  if (error.code === "OTP_EXPIRED") {
    return "This code has expired. Request a new code.";
  }

  if (error.code === "TOO_MANY_ATTEMPTS") {
    return "Too many incorrect codes. Request a new code.";
  }

  if (error.code === "INVALID_OTP") {
    return "The code is invalid. Check all six digits and try again.";
  }

  if (
    error.code === "USERNAME_IS_ALREADY_TAKEN" ||
    error.code === "INVALID_USERNAME"
  ) {
    return "Choose a different username using letters, numbers, dots, or underscores.";
  }

  return fallback;
}
