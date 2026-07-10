import React, { useState } from "react";
import {
  Button,
  Divider,
  Flex,
  Input,
  Select,
  Text,
  hubspot,
} from "@hubspot/ui-extensions";

import {
  PHONE_PROPERTY_OPTIONS,
  buildCallSummary,
  buildCardServerlessRequest,
  readObjectContext,
  readServerlessBody,
  reduceCardIntentState,
} from "./card-utils.mjs";

const DEFAULT_CALL_TASK = "Call this record and qualify whether they want a product demo. Ask whether they want human follow-up. Keep the call concise.";

hubspot.extend(({ context, actions }) => (
  <CallCandidateCard context={context} addAlert={actions.addAlert} />
));

function CallCandidateCard({ context, addAlert }) {
  const objectContext = readObjectContext(context);
  const [callTask, setCallTask] = useState(DEFAULT_CALL_TASK);
  const [phoneProperty, setPhoneProperty] = useState("phone");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [result, setResult] = useState(null);

  const applyIntentState = (nextState) => {
    setRequestId(nextState.requestId);
    setConfirming(nextState.confirming);
  };

  const startCall = async () => {
    if (!confirming) {
      applyIntentState(reduceCardIntentState(
        { requestId, confirming },
        { type: "begin" }
      ));
      return;
    }

    const activeIntent = reduceCardIntentState(
      { requestId, confirming },
      { type: "begin" }
    );
    setLoading(true);
    setResult(null);
    try {
      const response = await hubspot.serverless(
        "calle_start_call_from_card",
        buildCardServerlessRequest({
          objectContext,
          callTask,
          phoneProperty,
          requestId: activeIntent.requestId,
        })
      );
      const body = readServerlessBody(response);
      if (typeof body.success !== "boolean" || !String(body.status || "").trim()) {
        throw new Error("CALL-E returned an ambiguous server response. Retry this confirmation.");
      }
      setResult(body);
      addAlert({
        title: body.success ? "CALL-E call started" : "CALL-E call was not started",
        message: buildCallSummary(body),
        type: body.success ? "success" : "danger",
      });
      applyIntentState(reduceCardIntentState(
        activeIntent,
        { type: "result", result: body }
      ));
    } catch (error) {
      const body = {
        success: false,
        status: "failed",
        retry_same_intent: true,
        error: error.message,
      };
      setResult(body);
      addAlert({
        title: "CALL-E call failed",
        message: buildCallSummary(body),
        type: "danger",
      });
      applyIntentState(reduceCardIntentState(
        activeIntent,
        { type: "transport_error" }
      ));
    } finally {
      setLoading(false);
    }
  };

  const cancelConfirmation = () => {
    applyIntentState(reduceCardIntentState(
      { requestId, confirming },
      { type: "cancel" }
    ));
  };

  return (
    <Flex direction="column" gap="small">
      <Text format={{ fontWeight: "bold" }}>CALL-E direct call</Text>
      <Text>Record: {objectContext.objectType} {objectContext.objectId || "unknown"}</Text>
      <Divider />
      <Select
        label="Phone property"
        name="phone_property"
        value={phoneProperty}
        onChange={setPhoneProperty}
        options={PHONE_PROPERTY_OPTIONS}
        disabled={loading || confirming}
      />
      <Input
        label="Call task"
        name="call_task"
        value={callTask}
        onChange={setCallTask}
        placeholder="Describe the CALL-E task"
        disabled={loading || confirming}
      />
      {confirming && (
        <Text>Confirm this record is approved for phone contact before starting a CALL-E call.</Text>
      )}
      <Button
        onClick={startCall}
        disabled={loading || !objectContext.objectId || !objectContext.objectType || !String(callTask || "").trim()}
      >
        {loading
          ? "Starting..."
          : result && result.retry_same_intent
            ? "Retry CALL-E call"
            : confirming
              ? "Confirm and start CALL-E call"
              : "Start CALL-E Call"}
      </Button>
      {confirming && (
        <Button onClick={cancelConfirmation} disabled={loading}>
          Cancel
        </Button>
      )}
      {result && (
        <>
          <Divider />
          <Text>{buildCallSummary(result)}</Text>
        </>
      )}
    </Flex>
  );
}
