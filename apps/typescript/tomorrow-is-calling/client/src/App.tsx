import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader/AppHeader";
import { CallOverlay } from "./components/CallOverlay/CallOverlay";
import { PageLoader } from "./components/PageLoader/PageLoader";
import { ProgressStepper } from "./components/ProgressStepper/ProgressStepper";
import { demoCallTask, demoForm, demoOperations } from "./data/demoShipment";
import { LandingPage } from "./pages/LandingPage/LandingPage";
import { NewReadinessCheckPage } from "./pages/NewReadinessCheckPage/NewReadinessCheckPage";
import { OverviewPage } from "./pages/OverviewPage/OverviewPage";
import { ReadinessReportPage } from "./pages/ReadinessReportPage/ReadinessReportPage";
import { RequestSubmittedPage } from "./pages/RequestSubmittedPage/RequestSubmittedPage";
import { ReviewCallPage } from "./pages/ReviewCallPage/ReviewCallPage";
import { TemporaryCallTestPage } from "./pages/TemporaryCallTestPage";
import type { CallEResponse } from "./services/callEApi";
import type { AppView } from "./types/navigation";
import type { TransportOperation, TransportRequestForm } from "./types/transport";
import "./App.css";

function createReference() {
  return `AT-${Math.floor(1000 + Math.random() * 9000)}`;
}

function toOperation(request: TransportRequestForm): TransportOperation {
  return {
    id: request.reference,
    reference: request.reference,
    customer: request.customer.fullName,
    vehicle: `${request.vehicle.year} ${request.vehicle.make} ${request.vehicle.model}`,
    route: `${request.pickup.address} → ${request.delivery.address}`,
    status: "follow_up_required",
    nextAction: "Review and confirm customer request",
    isInteractive: true,
    isSample: false,
  };
}

function MainApp() {
  const [view, setView] = useState<AppView>("landing");
  const [form, setForm] = useState<TransportRequestForm>(demoForm);
  const [operations, setOperations] = useState<TransportOperation[]>(demoOperations);
  const [callOpen, setCallOpen] = useState(false);
  const [callResult, setCallResult] = useState<CallEResponse>();
  const restoreOverviewFocus = useRef(false);

  const show = (next: AppView) => {
    setCallOpen(false);
    setView(next);
  };

  useEffect(() => {
    if (restoreOverviewFocus.current && view === "overview") {
      document.getElementById("overview-start-check")?.focus();
      restoreOverviewFocus.current = false;
    }
  }, [view]);

  const startPublicRequest = () => {
    setForm({
      ...demoForm,
      reference: "AT-0000",
      customer: { ...demoForm.customer, phone: "" },
      status: "awaiting_customer_form",
    });
    setCallResult(undefined);
    show("request");
  };

  const submitPublicRequest = (data: TransportRequestForm) => {
    const submitted: TransportRequestForm = {
      ...data,
      reference: createReference(),
      status: "follow_up_required",
    };
    setForm(submitted);
    setCallResult(undefined);
    setOperations((current) => [toOperation(submitted), ...current.filter((item) => item.reference !== submitted.reference)]);
    show("submitted");
  };

  const openStaffRequest = (reference: string) => {
    if (form.reference !== reference) return;
    setCallResult(undefined);
    show("review");
  };

  const staffView = view === "overview" || view === "review" || view === "report" || view === "call-status";

  let page;
  switch (view) {
    case "request":
      page = <NewReadinessCheckPage initial={form} onSubmitRequest={submitPublicRequest} onCancel={() => show("landing")} />;
      break;
    case "submitted":
      page = <RequestSubmittedPage request={form} onHome={() => show("landing")} onStaff={() => show("overview")} />;
      break;
    case "overview":
      page = <OverviewPage operations={operations} onOpenRequest={openStaffRequest} onPublicSite={() => show("landing")} />;
      break;
    case "review":
      page = <ReviewCallPage data={form} onBegin={() => setCallOpen(true)} onBack={() => show("overview")} />;
      break;
    case "report":
      page = (
        <ReadinessReportPage
          request={form}
          result={callResult}
          onNew={startPublicRequest}
          onOverview={() => show("overview")}
        />
      );
      break;
    default:
      page = <LandingPage onRequest={startPublicRequest} onStaff={() => show("overview")} />;
  }

  return (
    <PageLoader>
      <div className="app-shell" aria-hidden={callOpen || undefined}>
        <div className="workspace">
          {staffView && <AppHeader view={view} onOverview={() => show("overview")} />}
          {(view === "review" || view === "report") && <ProgressStepper view={view} />}
          {page}
        </div>
      </div>
      {callOpen && (
        <CallOverlay
          request={form}
          task={{ ...demoCallTask, recipient: form.customer, requestReference: form.reference }}
          onClose={() => setCallOpen(false)}
          onReturnHome={() => {
            restoreOverviewFocus.current = true;
            show("overview");
          }}
          onViewReport={(result) => {
            setCallResult(result);
            show("report");
          }}
        />
      )}
    </PageLoader>
  );
}

function App() {
  return window.location.pathname === "/test-call" ? <TemporaryCallTestPage /> : <MainApp />;
}

export default App;
