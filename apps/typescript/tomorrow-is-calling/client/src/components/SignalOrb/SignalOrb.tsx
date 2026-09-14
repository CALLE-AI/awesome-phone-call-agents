import type { PrototypeCallState } from "../../types/call";
import "./SignalOrb.css";
export function SignalOrb({ state }: { state?: PrototypeCallState }) {
  return (
    <div
      className={`signal-orb ${state ? `signal-orb--${state}` : ""}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
      <i />
    </div>
  );
}
