const express = require("express");
const cors = require("cors");
const path = require("path");

const {
    startCall,
    getCallStatus
} = require("./calle/calleService");

const {
    analyzeTranscript
} = require("./analysis/scamAnalyzer");

const {
    saveScamInvestigation
} = require("./database/scamDatabase");


const app = express();

const PORT =
    process.env.PORT || 3000;


// --------------------------------------------------
// SERVER SECURITY CONFIGURATION
// --------------------------------------------------

// IMPORTANT:
// Set CALLGUARD_API_KEY in the environment before
// starting the server.
//
// Example PowerShell:
// $env:CALLGUARD_API_KEY="your-long-random-key"
//
const CALLGUARD_API_KEY =
    process.env.CALLGUARD_API_KEY || "";


// Comma-separated E.164 numbers that CallGuard is
// allowed to call.
//
// Example:
// +916364353485,+919876543210
//
const AUTHORIZED_RECIPIENTS =
    new Set(
        (process.env.CALLE_AUTHORIZED_RECIPIENTS || "")
            .split(",")
            .map(value => value.trim())
            .filter(Boolean)
    );


// --------------------------------------------------
// IN-MEMORY INVESTIGATION STATE
// --------------------------------------------------

const investigations =
    new Map();


// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(
    cors()
);

app.use(
    express.json({
        limit: "100kb"
    })
);


// Serve frontend files
app.use(
    express.static(
        path.join(
            __dirname,
            "..",
            "public"
        )
    )
);


// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function isValidE164(
    phoneNumber
) {

    return (
        typeof phoneNumber === "string" &&
        /^\+[1-9]\d{7,14}$/.test(
            phoneNumber.trim()
        )
    );

}


function sanitizePhoneNumber(
    phoneNumber
) {

    if (
        !phoneNumber ||
        typeof phoneNumber !== "string"
    ) {

        return null;

    }

    const value =
        phoneNumber.trim();

    if (
        value.length <= 4
    ) {

        return "****";

    }

    return (
        "*".repeat(
            Math.max(
                0,
                value.length - 4
            )
        ) +
        value.slice(-4)
    );

}


function getRunId(
    callResult
) {

    return (
        callResult?.run_id ||
        callResult?.result?.structuredContent?.run_id ||
        callResult?.result?.run_id ||
        null
    );

}


// --------------------------------------------------
// SERVER AUTHENTICATION
// --------------------------------------------------

function requireServerAuthentication(
    req,
    res,
    next
) {

    if (!CALLGUARD_API_KEY) {

        console.error(
            "CALLGUARD_API_KEY is not configured."
        );

        return res.status(503).json({

            ok: false,

            error:
                "CallGuard server authentication is not configured."

        });

    }


    const authorization =
        req.get("Authorization");


    const expected =
        `Bearer ${CALLGUARD_API_KEY}`;


    if (
        authorization !== expected
    ) {

        return res.status(401).json({

            ok: false,

            error:
                "Authentication required."

        });

    }


    next();

}


// --------------------------------------------------
// AUTHORIZED RECIPIENT CHECK
// --------------------------------------------------

function isAuthorizedRecipient(
    phoneNumber
) {

    return AUTHORIZED_RECIPIENTS.has(
        phoneNumber
    );

}


// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get(
    "/api/health",
    (req, res) => {

        res.json({

            ok: true,

            service:
                "CallGuard",

            message:
                "CallGuard server is running"

        });

    }
);


// --------------------------------------------------
// DRY-RUN INVESTIGATION
// --------------------------------------------------
//
// This endpoint NEVER calls CALL-E.
//
// It accepts a supplied transcript and runs the
// existing CallGuard analysis locally.
//
// This gives reviewers a safe way to test the
// investigation logic without making a real call.
//

app.post(
    "/api/investigate/dry-run",
    requireServerAuthentication,
    (req, res) => {

        try {

            const {
                transcript
            } = req.body || {};


            if (
                typeof transcript !== "string" ||
                transcript.trim().length === 0
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "A non-empty transcript is required for dry-run mode."

                });

            }


            if (
                transcript.length > 50000
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "Transcript is too large."

                });

            }


            const analysis =
                analyzeTranscript(
                    transcript
                );


            return res.json({

                ok: true,

                mode:
                    "DRY_RUN",

                status:
                    "COMPLETED",

                analysis

            });

        } catch (error) {

            console.error(
                "CallGuard dry-run error:",
                error.message
            );


            return res.status(500).json({

                ok: false,

                error:
                    "Unable to analyze the supplied transcript."

            });

        }

    }
);


// --------------------------------------------------
// START INVESTIGATION CALL
// --------------------------------------------------

app.post(
    "/api/investigate",
    requireServerAuthentication,
    async (req, res) => {

        let idempotencyKey = null;


        try {

            const {

                phoneNumber,

                authorizedRecipient,

                confirmLiveCall

            } = req.body || {};


            // ------------------------------------------
            // PHONE NUMBER VALIDATION
            // ------------------------------------------

            if (
                !isValidE164(
                    phoneNumber
                )
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "A valid E.164 phone number is required. Example: +916364353485"

                });

            }


            const normalizedPhoneNumber =
                phoneNumber.trim();


            // ------------------------------------------
            // SERVER-SIDE RECIPIENT ALLOWLIST
            // ------------------------------------------

            if (
                !isAuthorizedRecipient(
                    normalizedPhoneNumber
                )
            ) {

                return res.status(403).json({

                    ok: false,

                    error:
                        "This phone number is not on the server authorized-recipient allowlist."

                });

            }


            // ------------------------------------------
            // EXPLICIT USER AUTHORIZATION
            // ------------------------------------------

            if (
                authorizedRecipient !== true ||
                confirmLiveCall !== true
            ) {

                return res.status(403).json({

                    ok: false,

                    error:
                        "Explicit authorization and live-call confirmation are required before placing a real call."

                });

            }


            // ------------------------------------------
            // IDEMPOTENCY KEY
            // ------------------------------------------

            idempotencyKey =
                req.get(
                    "X-Idempotency-Key"
                );


            if (
                !idempotencyKey ||
                typeof idempotencyKey !== "string" ||
                idempotencyKey.length < 16 ||
                idempotencyKey.length > 200
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "A valid X-Idempotency-Key is required."

                });

            }


            // ------------------------------------------
            // CHECK EXISTING REQUEST
            // ------------------------------------------

            const existing =
                investigations.get(
                    idempotencyKey
                );


            if (existing) {

                return res.json({

                    ok: true,

                    status:
                        existing.status,

                    runId:
                        existing.runId,

                    message:
                        "This investigation request has already been accepted."

                });

            }


            // ------------------------------------------
            // INVESTIGATION GOAL
            // ------------------------------------------

            const goal = `

You are CallGuard, an AI phone security investigator.

You are conducting a controlled defensive investigation of a potentially suspicious
phone communication.

IMPORTANT SAFETY RULES:

- Identify yourself honestly as an AI assistant conducting a security investigation.
- Do not impersonate a bank employee, government official, police officer,
  recruiter, company representative, or any real person.
- Do not request, collect, repeat, or confirm any real OTP, password, PIN,
  CVV, banking credential, payment credential, or remote-access credential.
- Do not ask the caller to transfer money or provide sensitive personal information.
- Ask neutral questions and gather conversational evidence only.
- Do not make accusations or threaten the caller.
- End the call once sufficient evidence has been gathered.

INVESTIGATION OBJECTIVES:

1. Ask what organization, department, or service the caller represents.

2. Ask the caller to explain the purpose of the call.

3. Ask what action they want the recipient to take.

4. Determine whether the caller is requesting or discussing:

   - OTPs or verification codes
   - passwords, PINs, CVVs, or other credentials
   - payments or money transfers
   - remote access to a device
   - urgent account or KYC verification

5. Ask how the recipient can independently verify the caller's identity
   through an official channel.

6. Pay attention to conversational evidence such as:

   - bank or financial-service claims
   - KYC or account-verification claims
   - urgency or deadlines
   - threats of account suspension or other consequences
   - requests for sensitive information
   - payment requests
   - remote-access requests
   - refusal or inability to provide independent verification

CONVERSATION STYLE:

- Ask one concise question at a time.
- Wait for the caller's response before asking the next question.
- Do not reveal the scam indicators you are looking for.
- Do not coach the caller on what answers would make the call appear legitimate.
- Once enough evidence has been collected, thank the caller and politely end the call.

This is a CallGuard defensive security investigation.

`;


            // ------------------------------------------
            // RESERVE IDEMPOTENCY KEY BEFORE CALL
            // ------------------------------------------
            //
            // IMPORTANT:
            // The reservation happens BEFORE the await
            // that starts the real call.
            //

            investigations.set(
                idempotencyKey,
                {

                    runId:
                        null,

                    status:
                        "CALL_STARTING",

                    phoneNumber:
                        sanitizePhoneNumber(
                            normalizedPhoneNumber
                        ),

                    createdAt:
                        new Date().toISOString()

                }
            );


            console.log(
                `Starting CallGuard investigation for ${sanitizePhoneNumber(normalizedPhoneNumber)}`
            );


            // ------------------------------------------
            // START CALL-E CALL
            // ------------------------------------------

            const callResult =
                await startCall(
                    normalizedPhoneNumber,
                    goal
                );


            const runId =
                getRunId(
                    callResult
                );


            // ------------------------------------------
            // UNKNOWN CALL STATUS
            // ------------------------------------------

            if (!runId) {

                investigations.set(
                    idempotencyKey,
                    {

                        runId:
                            null,

                        status:
                            "CALL_START_UNKNOWN",

                        phoneNumber:
                            sanitizePhoneNumber(
                                normalizedPhoneNumber
                            ),

                        createdAt:
                            new Date().toISOString()

                    }
                );


                console.error(
                    "CALL-E did not return a run ID."
                );


                return res.status(502).json({

                    ok: false,

                    error:
                        "CALL-E call status could not be confirmed. The request is locked to prevent a duplicate call."

                });

            }


            // ------------------------------------------
            // UPDATE RESERVED REQUEST
            // ------------------------------------------

            investigations.set(
                idempotencyKey,
                {

                    runId,

                    status:
                        "CALL_STARTED",

                    phoneNumber:
                        sanitizePhoneNumber(
                            normalizedPhoneNumber
                        ),

                    createdAt:
                        new Date().toISOString()

                }
            );


            console.log(
                "CALL-E investigation started:",
                runId
            );


            return res.json({

                ok: true,

                status:
                    "CALL_STARTED",

                runId,

                message:
                    "CallGuard investigation call has started."

            });


        } catch (error) {

            console.error(
                "CallGuard investigation error:",
                error.message
            );


            // ------------------------------------------
            // FAIL CLOSED
            // ------------------------------------------

            if (
                idempotencyKey
            ) {

                const existing =
                    investigations.get(
                        idempotencyKey
                    );


                if (existing) {

                    investigations.set(
                        idempotencyKey,
                        {

                            ...existing,

                            status:
                                "CALL_START_UNKNOWN"

                        }
                    );

                }

            }


            return res.status(500).json({

                ok: false,

                error:
                    "Unable to confirm the CALL-E call status. The request is locked to prevent a duplicate call."

            });

        }

    }
);


// --------------------------------------------------
// GET INVESTIGATION STATUS / REPORT
// --------------------------------------------------

app.get(
    "/api/investigate/:runId",
    requireServerAuthentication,
    async (req, res) => {

        const {
            runId
        } = req.params;


        if (
            !runId ||
            runId.length > 200
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid investigation ID."

            });

        }


        try {

            console.log(
                "Checking CALL-E investigation:",
                runId
            );


            const callResult =
                await getCallStatus(
                    runId
                );


            const structured =
                callResult?.result?.structuredContent;


            // ------------------------------------------
            // PROVIDER RESPONSE NOT READY
            // ------------------------------------------

            if (!structured) {

                return res.json({

                    ok: true,

                    status:
                        "PROCESSING",

                    message:
                        "Investigation is still being processed."

                });

            }


            const status =
                structured.status ||
                "UNKNOWN";


            // ------------------------------------------
            // CALL STILL RUNNING
            // ------------------------------------------

            if (

                status !== "COMPLETED" &&
                status !== "FAILED" &&
                status !== "NO ANSWER" &&
                status !== "DECLINED"

            ) {

                return res.json({

                    ok: true,

                    status,

                    message:
                        "Call is still in progress."

                });

            }


            // ------------------------------------------
            // CALL FINISHED
            // ------------------------------------------

            const result =
                structured.result || {};


            const transcript =
                typeof result.transcript === "string"
                    ? result.transcript
                    : "";


            const analysis =
                analyzeTranscript(
                    transcript
                );


            // ------------------------------------------
            // SAVE REUSABLE SCAM INTELLIGENCE
            // ------------------------------------------

            const savedSignature =
                saveScamInvestigation(

                    null,

                    analysis,

                    result.summary || ""

                );


            // ------------------------------------------
            // SAFE RESPONSE
            // ------------------------------------------

            return res.json({

                ok: true,

                status,

                runId,

                signatureMatch:

                    savedSignature

                        ? {

                            id:
                                savedSignature.id,

                            signature:
                                savedSignature.signature,

                            occurrences:
                                savedSignature.occurrences

                        }

                        : null,

                callSummary:
                    result.summary || null,

                transcript,

                callOutcome:
                    result.outcome || null,

                analysis

            });


        } catch (error) {

            console.error(
                "CallGuard status error:",
                error.message
            );


            return res.status(500).json({

                ok: false,

                error:
                    "Unable to retrieve the investigation status."

            });

        }

    }
);


// --------------------------------------------------
// SCAM INTELLIGENCE
// --------------------------------------------------

app.get(
    "/api/signatures",
    requireServerAuthentication,
    (req, res) => {

        try {

            const signatures =
                require("./database/scamDatabase")
                    .getAllSignatures();


            const safeSignatures =
                signatures.map(
                    signature => ({

                        id:
                            signature.id,

                        signature:
                            signature.signature,

                        scamType:
                            signature.scamType,

                        riskLevel:
                            signature.riskLevel,

                        riskScore:
                            signature.riskScore,

                        confidence:
                            signature.confidence,

                        occurrences:
                            signature.occurrences,

                        firstSeen:
                            signature.firstSeen,

                        lastSeen:
                            signature.lastSeen,

                        latestSummary:
                            signature.latestSummary

                    })
                );


            return res.json({

                ok: true,

                count:
                    safeSignatures.length,

                signatures:
                    safeSignatures

            });

        } catch (error) {

            console.error(
                "Scam intelligence error:",
                error.message
            );


            return res.status(500).json({

                ok: false,

                error:
                    "Unable to load scam intelligence."

            });

        }

    }
);


// --------------------------------------------------
// 404 API HANDLER
// --------------------------------------------------

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            ok: false,

            error:
                "API endpoint not found."

        });

    }
);


// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use(
    (error, req, res, next) => {

        console.error(
            "Unhandled server error:",
            error.message
        );


        res.status(500).json({

            ok: false,

            error:
                "Internal server error."

        });

    }
);


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
    PORT,
    () => {

        console.log(
            `CallGuard server running on port ${PORT}`
        );

        console.log(
            `Local URL: http://localhost:${PORT}`
        );

    }
);