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
  nextCardRequestId,
  readObjectContext,
  readServerlessBody,
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

  const startCall = async () => {
    if (!confirming) {
      setRequestId(nextCardRequestId(requestId, "begin"));
      setConfirming(true);
      return;
    }

    const activeRequestId = nextCardRequestId(requestId, "begin");
    setLoading(true);
    setResult(null);
    try {
      const response = await hubspot.serverless(
        "calle_start_call_from_card",
        buildCardServerlessRequest({
          objectContext,
          callTask,
          phoneProperty,
          requestId: activeRequestId,
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
      setRequestId(nextCardRequestId(activeRequestId, "terminal"));
      setConfirming(false);
    } catch (error) {
      const body = {
        success: false,
        status: "failed",
        error: error.message,
      };
      setResult(body);
      addAlert({
        title: "CALL-E call failed",
        message: buildCallSummary(body),
        type: "danger",
      });
      setRequestId(nextCardRequestId(activeRequestId, "ambiguous_error"));
      setConfirming(true);
    } finally {
      setLoading(false);
    }
  };

  const cancelConfirmation = () => {
    setRequestId(nextCardRequestId(requestId, "cancel"));
    setConfirming(false);
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
        {loading ? "Starting..." : confirming ? "Confirm and start CALL-E call" : "Start CALL-E Call"}
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
