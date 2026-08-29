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
    saveScamInvestigation,
    findSignature
} = require("./database/scamDatabase");


const app = express();

const PORT = 3000;


// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(cors());
app.use(express.json());


// Serve frontend files from /public
app.use(express.static(
    path.join(__dirname, "..", "public")
));


// --------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", (req, res) => {

    res.json({
        ok: true,
        service: "CallGuard",
        message: "CallGuard server is running"
    });

});


// --------------------------------------------------
// START INVESTIGATION CALL
// --------------------------------------------------

app.post("/api/investigate", async (req, res) => {

    try {

        const {
            phoneNumber
        } = req.body;


        // Basic validation
        if (!phoneNumber) {

            return res.status(400).json({
                ok: false,
                error: "Phone number is required"
            });

        }


        console.log(
            `\n📞 Starting CallGuard investigation for ${phoneNumber}`
        );


        // Investigation instructions
        const goal = `
You are CallGuard, an AI phone security investigator.

You are conducting a controlled verification call about a potentially suspicious phone communication.

IMPORTANT:
- Identify yourself as an AI assistant.
- Do not impersonate a bank employee, government official, police officer, recruiter, or any real person.
- Do not request passwords, OTPs, PINs, CVVs, or other secrets from the recipient.
- Ask neutral questions and gather evidence.
- Explain that the purpose is to understand what organization or service the caller represents and what action they are requesting.

During the conversation, investigate:

1. What organization or service the caller claims to represent.
2. Why they contacted the recipient.
3. What action they want the recipient to take.
4. Whether they create urgency or threaten consequences.
5. Whether they request money, payment, OTPs, passwords, PINs, CVVs, KYC information, or remote device access.
6. Whether they provide a legitimate way to independently verify their identity.

Ask concise follow-up questions when appropriate.

Do not accuse the person of being a scammer during the call.

At the end, politely thank them and end the call.

This is a CallGuard security investigation.
`;


        // Start CALL-E call
        const callResult = await startCall(
            phoneNumber,
            goal
        );


        console.log(
            "✅ CALL-E call started"
        );


        // Extract run ID
        const runId =
            callResult?.run_id ||
            callResult?.result?.structuredContent?.run_id ||
            callResult?.result?.run_id;


        if (!runId) {

            console.error(
                "CALL-E did not return a run ID:",
                callResult
            );

            return res.status(500).json({
                ok: false,
                error: "CALL-E did not return a run ID",
                raw: callResult
            });

        }


        // Return immediately.
        // The frontend can poll for the result.
        res.json({

            ok: true,

            status: "CALL_STARTED",

            runId,

            message:
                "CallGuard investigation call has started."
        });


    } catch (error) {

        console.error(
            "❌ Investigation error:",
            error
        );

        res.status(500).json({

            ok: false,

            error: error.message
        });

    }

});


// --------------------------------------------------
// GET INVESTIGATION RESULT
// --------------------------------------------------

app.get("/api/investigate/:runId", async (req, res) => {

    try {

        const {
            runId
        } = req.params;


        console.log(
            `🔍 Checking CALL-E run: ${runId}`
        );


        const callResult =
            await getCallStatus(runId);


        const structured =
            callResult?.result?.structuredContent;


        // If structuredContent is not present,
        // return raw result for debugging.
        if (!structured) {

            return res.json({

                ok: true,

                status: "PROCESSING",

                raw: callResult
            });

        }


        const status =
            structured.status;


        // Call is still running
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
                    structured.message ||
                    "Call is still in progress."
            });

        }


        // --------------------------------------------------
        // CALL FINISHED
        // --------------------------------------------------

        const result =
            structured.result || {};


        const transcript =
            result.transcript || "";


        // Analyze transcript
        const analysis =
            analyzeTranscript(transcript);

        // --------------------------------------------------
// Save reusable scam intelligence
// --------------------------------------------------

        const savedSignature =
            saveScamInvestigation(
                null,
                analysis,
                result.summary || ""
           );


        // Send complete CallGuard report
        res.json({

    ok: true,

    status,

    runId,

    signatureMatch:
        savedSignature
            ? {
                id: savedSignature.id,
                signature: savedSignature.signature,
                occurrences: savedSignature.occurrences
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
            "❌ Status error:",
            error
        );


        res.status(500).json({

            ok: false,

            error: error.message

        });

    }

});


// --------------------------------------------------
// START SERVER
// --------------------------------------------------
// --------------------------------------------------
// SCAM INTELLIGENCE
// --------------------------------------------------

app.get("/api/signatures", (req, res) => {

    try {

        const {
            getAllSignatures
        } = require("./database/scamDatabase");


        const signatures =
            getAllSignatures();


        res.json({

            ok: true,

            count:
                signatures.length,

            signatures

        });

    } catch (error) {

        console.error(
            "❌ Signature database error:",
            error
        );


        res.status(500).json({

            ok: false,

            error: error.message

        });

    }

});




app.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("       🚨 CALLGUARD SERVER 🚨");
    console.log("======================================");
    console.log("");
    console.log(
        `🌐 http://localhost:${PORT}`
    );
    console.log("");
    console.log(
        "📞 CALL-E integration: READY"
    );
    console.log(
        "🧠 Scam analyzer: READY"
    );
    console.log("");

});