import { type ReactNode, useEffect, useRef, useState } from "react";
import "./PageLoader.css";

const STAGES = [
  { progress: 0, status: "Establishing temporal connection", console: "searching adjacent timelines" },
  { progress: 14, status: "Authenticating receiver", console: "receiver signature accepted" },
  { progress: 28, status: "Locating future signal", console: "anomaly detected at T+07 days" },
  { progress: 42, status: "Synchronizing voice channel", console: "audio relay responding" },
  { progress: 57, status: "Decrypting transmission", console: "future-origin packet confirmed" },
  { progress: 71, status: "Stabilizing connection", console: "signal drift within safe limits" },
  { progress: 84, status: "Calibrating call interface", console: "speaker channel online" },
  { progress: 94, status: "Preparing secure handoff", console: "stand by for incoming signal" },
  { progress: 100, status: "Temporal link online", console: "tomorrow is calling" },
] as const;

const FALLBACK_DELAY = 1_500;
const STAGE_DURATION = 420;
const EXIT_DURATION = 650;
const LOADER_SESSION_KEY = "tomorrow-is-calling:loader-seen";

type PageLoaderProps = { children: ReactNode };

export function PageLoader({ children }: PageLoaderProps) {
  const [skipLoader] = useState(
    () => typeof window !== "undefined" && sessionStorage.getItem(LOADER_SESSION_KEY) === "true",
  );
  const [phase, setPhase] = useState<"loading" | "exiting" | "complete">(
    skipLoader ? "complete" : "loading",
  );
  const [progress, setProgress] = useState(skipLoader ? 100 : 0);
  const [stageIndex, setStageIndex] = useState(skipLoader ? STAGES.length - 1 : 0);
  const [clock, setClock] = useState(() => formatLocalTime());
  const started = useRef(false);
  const originalBodyOverflow = useRef("");

  useEffect(() => {
    if (phase === "complete") return;
    originalBodyOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalBodyOverflow.current;
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "complete") document.body.style.overflow = originalBodyOverflow.current;
  }, [phase]);

  useEffect(() => {
    if (phase === "complete") return;
    const clockTimer = window.setInterval(() => setClock(formatLocalTime()), 1_000);
    return () => window.clearInterval(clockTimer);
  }, [phase]);

  useEffect(() => {
    if (skipLoader) return;

    let fallbackTimer: number | undefined;
    let animationFrame: number | undefined;
    let exitTimer: number | undefined;

    const start = () => {
      if (started.current) return;
      started.current = true;

      let currentStage = 0;
      let startedAt: number | undefined;

      const animate = (timestamp: number) => {
        if (startedAt === undefined) startedAt = timestamp;
        const from = STAGES[currentStage].progress;
        const next = STAGES[currentStage + 1];

        if (!next) {
          setPhase("exiting");
          exitTimer = window.setTimeout(() => {
            sessionStorage.setItem(LOADER_SESSION_KEY, "true");
            setPhase("complete");
          }, EXIT_DURATION);
          return;
        }

        const elapsed = Math.min((timestamp - startedAt) / STAGE_DURATION, 1);
        setProgress(Math.round(from + (next.progress - from) * elapsed));

        if (elapsed === 1) {
          currentStage += 1;
          startedAt = timestamp;
          setStageIndex(currentStage);
        }

        animationFrame = window.requestAnimationFrame(animate);
      };

      animationFrame = window.requestAnimationFrame(animate);
    };

    if (document.readyState === "complete") start();
    else {
      window.addEventListener("load", start, { once: true });
      fallbackTimer = window.setTimeout(start, FALLBACK_DELAY);
    }

    return () => {
      started.current = false;
      window.removeEventListener("load", start);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
    };
  }, [skipLoader]);

  const stage = STAGES[stageIndex];
  const segmentsComplete = Math.round(progress / 10);

  return (
    <>
      <div className={`page-loader__content ${phase === "complete" ? "is-visible" : ""}`}>{children}</div>
      {phase !== "complete" && (
        <section className={`page-loader ${phase === "exiting" ? "is-exiting" : ""}`} aria-label="Temporal link initialization">
          <img className="page-loader__city" src="https://assets.codepen.io/11990995/perceived-futuristic-city.png" alt="" aria-hidden="true" />
          <div className="page-loader__wash" aria-hidden="true" />
          <div className="page-loader__scanlines" aria-hidden="true" />
          <div className="page-loader__corner page-loader__corner--top-left"><span>SIGNAL NETWORK</span><strong>RECEIVER 07-A</strong></div>
          <div className="page-loader__corner page-loader__corner--top-right"><span>LOCAL TIME</span><strong>{clock}</strong></div>
          <div className="page-loader__corner page-loader__corner--bottom-left"><span>SIGNAL ORIGIN</span><strong>T+07 DAYS / UNKNOWN</strong></div>
          <div className="page-loader__corner page-loader__corner--bottom-right"><span>SECURITY</span><strong className="page-loader__secure">ENCRYPTED</strong></div>
          <div className="page-loader__center">
            <p className="page-loader__hud-label">Temporal link boot</p>
            <div className="page-loader__rings" aria-hidden="true"><span /><span /><span /></div>
            <div className="page-loader__percentage" aria-hidden="true">{progress}<small>%</small></div>
            <div className="page-loader__progress" role="progressbar" aria-label="Temporal link initialization progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <span className="page-loader__progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
            </div>
            <div className="page-loader__segments" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <span className={index < segmentsComplete ? "is-complete" : ""} key={index} />)}</div>
            <p className="page-loader__status">{stage.status}</p>
            <p className="page-loader__console"><span aria-hidden="true">›</span> {stage.console}</p>
          </div>
        </section>
      )}
    </>
  );
}

function formatLocalTime() {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
}
