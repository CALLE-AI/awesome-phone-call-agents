let currentRunId = null;
let statusTimer = null;


// ==================================================
// SERVER AUTHENTICATION
// ==================================================

const API_KEY_STORAGE =
    "callguard_server_api_key";


function getApiKey() {

    return sessionStorage.getItem(
        API_KEY_STORAGE
    ) || "";

}


function requestApiKey() {

    let apiKey =
        getApiKey();


    if (apiKey) {

        return apiKey;

    }


    apiKey =
        window.prompt(
            "Enter the CallGuard server API key:"
        );


    if (
        !apiKey ||
        !apiKey.trim()
    ) {

        return "";

    }


    apiKey =
        apiKey.trim();


    sessionStorage.setItem(
        API_KEY_STORAGE,
        apiKey
    );


    return apiKey;

}


function authenticatedHeaders(
    includeJson = false
) {

    const apiKey =
        getApiKey();


    const headers = {

        "Authorization":
            `Bearer ${apiKey}`

    };


    if (includeJson) {

        headers[
            "Content-Type"
        ] =
            "application/json";

    }


    return headers;

}


// ==================================================
// ELEMENTS
// ==================================================

const phoneInput =
    document.getElementById(
        "phoneNumber"
    );

const authorizeCall =
    document.getElementById(
        "authorizeCall"
    );

const investigateButton =
    document.getElementById(
        "investigateButton"
    );

const statusBox =
    document.getElementById(
        "status"
    );

const report =
    document.getElementById(
        "report"
    );


// ==================================================
// STATUS MESSAGE
// ==================================================

function showStatus(
    message,
    type = "info"
) {

    if (!statusBox) {

        return;

    }


    statusBox.className =
        `status ${type}`;

    statusBox.textContent =
        message;

}


function hideStatus() {

    if (!statusBox) {

        return;

    }


    statusBox.className =
        "status hidden";

}


// ==================================================
// GENERATE IDEMPOTENCY KEY
// ==================================================

function generateIdempotencyKey() {

    if (

        window.crypto &&

        typeof window.crypto.randomUUID ===
            "function"

    ) {

        return window.crypto.randomUUID();

    }


    return (

        Date.now().toString(36) +

        "-" +

        Math.random()
            .toString(36)
            .substring(2)

    );

}


// ==================================================
// HANDLE AUTHENTICATION ERROR
// ==================================================

function handleAuthenticationFailure() {

    sessionStorage.removeItem(
        API_KEY_STORAGE
    );


    showStatus(
        "🔐 Server authentication failed. Please try again with the correct CallGuard API key.",
        "error"
    );

}


// ==================================================
// INVESTIGATE CALL
// ==================================================

async function investigateCall() {

    const phoneNumber =
        phoneInput
            ? phoneInput.value.trim()
            : "";


    // ------------------------------------------
    // Phone number required
    // ------------------------------------------

    if (!phoneNumber) {

        showStatus(
            "Please enter a phone number.",
            "error"
        );

        return;

    }


    // ------------------------------------------
    // Explicit recipient authorization
    // ------------------------------------------

    if (

        !authorizeCall ||

        !authorizeCall.checked

    ) {

        showStatus(
            "Please confirm that you are authorized to investigate this number.",
            "error"
        );

        return;

    }


    // ------------------------------------------
    // Explicit real-call confirmation
    // ------------------------------------------

    const confirmLiveCall =
        document.getElementById(
            "confirmLiveCall"
        );


    if (

        !confirmLiveCall ||

        !confirmLiveCall.checked

    ) {

        showStatus(
            "Please confirm that you understand this action will place a real phone call.",
            "error"
        );

        return;

    }


    // ------------------------------------------
    // E.164 validation
    // ------------------------------------------

    const e164PhoneNumber =
        /^\+[1-9]\d{7,14}$/;


    if (
        !e164PhoneNumber.test(
            phoneNumber
        )
    ) {

        showStatus(
            "Please enter a valid E.164 phone number, for example +916364353485.",
            "error"
        );

        return;

    }


    // ------------------------------------------
    // Get server authentication
    // ------------------------------------------

    const apiKey =
        requestApiKey();


    if (!apiKey) {

        showStatus(
            "🔐 A CallGuard server API key is required.",
            "error"
        );

        return;

    }


    // ------------------------------------------
    // Create unique request key
    // ------------------------------------------

    const idempotencyKey =
        generateIdempotencyKey();


    investigateButton.disabled =
        true;

    investigateButton.textContent =
        "📞 Starting investigation...";


    if (report) {

        report.classList.add(
            "hidden"
        );

    }


    showStatus(
        "📞 CallGuard is preparing a real CALL-E investigation...",
        "info"
    );


    try {

        const response =
            await fetch(

                "/api/investigate",

                {

                    method:
                        "POST",

                    headers: {

                        ...authenticatedHeaders(
                            true
                        ),

                        "X-Idempotency-Key":
                            idempotencyKey

                    },

                    body:
                        JSON.stringify({

                            phoneNumber,

                            // This value comes from
                            // the authorization checkbox.
                            authorizedRecipient:
                                authorizeCall.checked,

                            // This value comes from
                            // the real-call confirmation.
                            confirmLiveCall:
                                confirmLiveCall.checked

                        })

                }

            );


        // ------------------------------------------
        // Authentication failure
        // ------------------------------------------

        if (
            response.status === 401
        ) {

            handleAuthenticationFailure();

            throw new Error(
                "Server authentication failed."
            );

        }


        const data =
            await response.json();


        if (

            !response.ok ||

            !data.ok

        ) {

            throw new Error(

                data.error ||

                "Investigation could not be started."

            );

        }


        currentRunId =
            data.runId;


        showStatus(
            "📞 CALL-E is calling the authorized number. Please answer your phone...",
            "info"
        );


        investigateButton.textContent =
            "📞 Call in progress...";


        pollInvestigation();


    } catch (error) {

        console.error(
            error
        );


        showStatus(
            `❌ ${error.message}`,
            "error"
        );


        investigateButton.disabled =
            false;

        investigateButton.textContent =
            "🔍 Investigate Call";

    }

}


// ==================================================
// POLL INVESTIGATION
// ==================================================

async function pollInvestigation() {

    if (!currentRunId) {

        return;

    }


    try {

        const response =
            await fetch(

                `/api/investigate/${encodeURIComponent(
                    currentRunId
                )}`,

                {

                    method:
                        "GET",

                    headers:
                        authenticatedHeaders()

                }

            );


        if (
            response.status === 401
        ) {

            handleAuthenticationFailure();

            throw new Error(
                "Server authentication failed."
            );

        }


        const data =
            await response.json();


        if (

            !response.ok ||

            !data.ok

        ) {

            throw new Error(

                data.error ||

                "Could not retrieve investigation status."

            );

        }


        const status =
            data.status;


        console.log(
            "Investigation status:",
            status
        );


        // ------------------------------------------
        // CALL STILL RUNNING
        // ------------------------------------------

        if (

            status === "PREPARING" ||

            status === "RUNNING" ||

            status === "IN_PROGRESS" ||

            status === "PROCESSING" ||

            status === "CALL_STARTING" ||

            status === "CALL_STARTED"

        ) {

            showStatus(
                "📞 Call in progress... Please continue the conversation.",
                "info"
            );


            statusTimer =
                setTimeout(
                    pollInvestigation,
                    5000
                );


            return;

        }


        // ------------------------------------------
        // UNKNOWN CALL START
        // ------------------------------------------

        if (

            status ===
                "CALL_START_UNKNOWN"

        ) {

            throw new Error(

                "The CALL-E call status could not be confirmed. The request remains locked to prevent a duplicate call."

            );

        }


        // ------------------------------------------
        // COMPLETED
        // ------------------------------------------

        if (

            status === "COMPLETED" ||

            status === "SUCCEEDED" ||

            data.analysis

        ) {

            clearTimeout(
                statusTimer
            );


            displayReport(
                data
            );


            showStatus(
                "✅ Investigation completed.",
                "success"
            );


            investigateButton.disabled =
                false;

            investigateButton.textContent =
                "🔍 Investigate Again";


            loadSignatures();


            return;

        }


        // ------------------------------------------
        // FAILED
        // ------------------------------------------

        if (

            status === "FAILED" ||

            status === "ERROR" ||

            status === "NO ANSWER" ||

            status === "DECLINED"

        ) {

            throw new Error(

                data.error ||

                `CALL-E investigation ended with status: ${status}`

            );

        }


        // ------------------------------------------
        // UNKNOWN / WAIT
        // ------------------------------------------

        statusTimer =
            setTimeout(
                pollInvestigation,
                5000
            );


    } catch (error) {

        console.error(
            error
        );


        showStatus(
            `❌ ${error.message}`,
            "error"
        );


        investigateButton.disabled =
            false;

        investigateButton.textContent =
            "🔍 Investigate Call";

    }

}


// ==================================================
// DISPLAY REPORT
// ==================================================

function displayReport(
    data
) {

    const analysis =
        data.analysis || {};


    if (!report) {

        return;

    }


    report.classList.remove(
        "hidden"
    );


    // ------------------------------------------
    // Risk
    // ------------------------------------------

    const riskLevel =
        analysis.riskLevel ||
        "UNKNOWN";


    const riskScore =
        analysis.riskScore ??
        0;


    const riskLevelElement =
        document.getElementById(
            "riskLevel"
        );


    const riskScoreElement =
        document.getElementById(
            "riskScore"
        );


    if (riskLevelElement) {

        riskLevelElement.textContent =
            riskLevel;

    }


    if (riskScoreElement) {

        riskScoreElement.textContent =
            riskScore;

    }


    const riskCard =
        document.getElementById(
            "riskCard"
        );


    if (riskCard) {

        riskCard.className =
            `risk-card ${riskLevel.toLowerCase()}`;

    }


    // ------------------------------------------
    // Scam Type
    // ------------------------------------------

    const scamTypeElement =
        document.getElementById(
            "scamType"
        );


    if (scamTypeElement) {

        scamTypeElement.textContent =
            analysis.scamType ||
            "No specific scam pattern identified";

    }


    // ------------------------------------------
    // Signature
    // ------------------------------------------

    const signatureElement =
        document.getElementById(
            "scamSignature"
        );


    if (signatureElement) {

        signatureElement.textContent =
            analysis.scamSignature ||
            "NO_STRONG_SIGNATURE";

    }


    // ------------------------------------------
    // Recommendation
    // ------------------------------------------

    const recommendationElement =
        document.getElementById(
            "recommendation"
        );


    if (recommendationElement) {

        recommendationElement.textContent =
            analysis.recommendation ||
            "Exercise caution and verify the caller independently.";

    }


    // ------------------------------------------
    // Summary
    // ------------------------------------------

    const summaryElement =
        document.getElementById(
            "callSummary"
        );


    if (summaryElement) {

        summaryElement.textContent =
            data.summary ||
            data.callSummary ||
            "No summary available.";

    }


    // ------------------------------------------
    // Indicators
    // ------------------------------------------

    const indicatorContainer =
        document.getElementById(
            "indicators"
        );


    if (indicatorContainer) {

        indicatorContainer.innerHTML =
            "";

    }


    const indicators =
        Array.isArray(
            analysis.indicators
        )
            ? analysis.indicators
            : [];


    indicators.forEach(
        indicator => {

            if (!indicatorContainer) {

                return;

            }


            const element =
                document.createElement(
                    "div"
                );


            element.className =
                "indicator";


            element.innerHTML = `
                <span>🚩</span>
                <div>
                    <strong>${escapeHtml(
                        indicator.type ||
                        "Indicator"
                    )}</strong>

                    <p>${escapeHtml(
                        indicator.description ||
                        ""
                    )}</p>
                </div>
            `;


            indicatorContainer.appendChild(
                element
            );

        }
    );


    // ------------------------------------------
    // Transcript
    // ------------------------------------------

    const transcriptContainer =
        document.getElementById(
            "transcript"
        );


    if (transcriptContainer) {

        transcriptContainer.innerHTML =
            "";

    }


    const transcript =
        data.transcript ||
        analysis.transcript ||
        "";


    if (transcript) {

        transcript
            .split("\n")
            .forEach(
                line => {

                    if (
                        !line.trim()
                    ) {

                        return;

                    }


                    if (
                        !transcriptContainer
                    ) {

                        return;

                    }


                    const element =
                        document.createElement(
                            "div"
                        );


                    element.className =
                        line.includes("USER:")
                            ? "transcript-line caller"
                            : "transcript-line bot";


                    element.textContent =
                        line;


                    transcriptContainer
                        .appendChild(
                            element
                        );

                }
            );

    } else if (
        transcriptContainer
    ) {

        transcriptContainer.textContent =
            "Transcript unavailable.";

    }


    // ------------------------------------------
    // Signature match
    // ------------------------------------------

    const matchCard =
        document.getElementById(
            "matchCard"
        );


    if (

        matchCard &&

        data.signatureMatch &&

        data.signatureMatch.occurrences > 1

    ) {

        matchCard.classList.remove(
            "hidden"
        );


        const matchMessage =
            document.getElementById(
                "matchMessage"
            );


        if (matchMessage) {

            matchMessage.textContent =
                `This scam pattern has been observed ${data.signatureMatch.occurrences} times.`;

        }

    } else if (matchCard) {

        matchCard.classList.add(
            "hidden"
        );

    }


    // ------------------------------------------
    // Scroll to report
    // ------------------------------------------

    report.scrollIntoView({
        behavior:
            "smooth"
    });

}


// ==================================================
// LOAD SCAM INTELLIGENCE
// ==================================================

async function loadSignatures() {

    const list =
        document.getElementById(
            "signatureList"
        );


    const count =
        document.getElementById(
            "signatureCount"
        );


    try {

        const response =
            await fetch(

                "/api/signatures",

                {

                    method:
                        "GET",

                    headers:
                        authenticatedHeaders()

                }

            );


        if (
            response.status === 401
        ) {

            if (getApiKey()) {

                handleAuthenticationFailure();

            }


            if (count) {

                count.textContent =
                    "Authentication required";

            }

            return;

        }


        const data =
            await response.json();


        if (!data.ok) {

            throw new Error(
                data.error ||
                "Could not load signatures."
            );

        }


        const signatures =
            data.signatures ||
            [];


        if (count) {

            count.textContent =
                `${signatures.length} known scam pattern${
                    signatures.length === 1
                        ? ""
                        : "s"
                }`;

        }


        if (!list) {

            return;

        }


        list.innerHTML =
            "";


        if (
            signatures.length === 0
        ) {

            list.innerHTML = `
                <div class="empty-state">
                    No scam patterns have been discovered yet.
                </div>
            `;

            return;

        }


        signatures
            .slice()
            .reverse()
            .forEach(
                signature => {

                    const card =
                        document.createElement(
                            "div"
                        );


                    card.className =
                        "signature-card";


                    card.innerHTML = `

                        <div class="signature-header">

                            <span class="badge">
                                ${escapeHtml(
                                    signature.riskLevel
                                )}
                            </span>

                            <span>
                                Seen ${
                                    signature.occurrences
                                } time${
                                    signature.occurrences === 1
                                        ? ""
                                        : "s"
                                }
                            </span>

                        </div>


                        <h3>
                            ${escapeHtml(
                                signature.scamType
                            )}
                        </h3>


                        <code>
                            ${escapeHtml(
                                signature.signature
                            )}
                        </code>


                        <p>
                            ${escapeHtml(
                                signature.latestSummary ||
                                "No summary available."
                            )}
                        </p>

                    `;


                    list.appendChild(
                        card
                    );

                }
            );


    } catch (error) {

        console.error(
            error
        );


        if (count) {

            count.textContent =
                "Intelligence unavailable";

        }

    }

}


// ==================================================
// HTML ESCAPING
// ==================================================

function escapeHtml(
    value
) {

    return String(
        value ?? ""
    )

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}


// ==================================================
// DRY RUN ANALYSIS
// ==================================================

async function runDryRun() {

    const transcriptInput =
        document.getElementById(
            "dryRunTranscript"
        );

    const dryRunButton =
        document.getElementById(
            "dryRunButton"
        );

    const dryRunStatus =
        document.getElementById(
            "dryRunStatus"
        );

    const dryRunResult =
        document.getElementById(
            "dryRunResult"
        );


    const transcript =
        transcriptInput
            ? transcriptInput.value.trim()
            : "";


    if (!transcript) {

        dryRunStatus.className =
            "status error";

        dryRunStatus.textContent =
            "Please enter a call transcript.";

        return;

    }


    const apiKey =
        requestApiKey();


    if (!apiKey) {

        dryRunStatus.className =
            "status error";

        dryRunStatus.textContent =
            "🔐 A CallGuard server API key is required.";

        return;

    }


    dryRunButton.disabled =
        true;

    dryRunButton.textContent =
        "🧪 Analyzing...";


    dryRunStatus.className =
        "status info";

    dryRunStatus.textContent =
        "🧪 Analyzing transcript without making a phone call.";


    if (dryRunResult) {

        dryRunResult.classList.add(
            "hidden"
        );

    }


    try {

        const response =
            await fetch(

                "/api/investigate/dry-run",

                {

                    method:
                        "POST",

                    headers:
                        authenticatedHeaders(
                            true
                        ),

                    body:
                        JSON.stringify({

                            transcript

                        })

                }

            );


        if (
            response.status === 401
        ) {

            handleAuthenticationFailure();

            throw new Error(
                "Server authentication failed."
            );

        }


        const data =
            await response.json();


        if (

            !response.ok ||

            !data.ok

        ) {

            throw new Error(

                data.error ||

                "Dry-run analysis failed."

            );

        }


        const analysis =
            data.analysis || {};


        const riskLevel =
            document.getElementById(
                "dryRunRiskLevel"
            );


        const riskScore =
            document.getElementById(
                "dryRunRiskScore"
            );


        const scamType =
            document.getElementById(
                "dryRunScamType"
            );


        const confidence =
            document.getElementById(
                "dryRunConfidence"
            );


        if (riskLevel) {

            riskLevel.textContent =
                analysis.riskLevel ||
                "UNKNOWN";

        }


        if (riskScore) {

            riskScore.textContent =
                analysis.riskScore ??
                0;

        }


        if (scamType) {

            scamType.textContent =
                analysis.scamType ||
                "No specific scam pattern identified";

        }


        if (confidence) {

            confidence.textContent =
                analysis.confidence ??
                0;

        }


        if (dryRunResult) {

            dryRunResult.classList.remove(
                "hidden"
            );

        }


        dryRunStatus.className =
            "status success";

        dryRunStatus.textContent =
            "✅ Dry run completed. No phone call was made.";


    } catch (error) {

        console.error(
            error
        );


        dryRunStatus.className =
            "status error";

        dryRunStatus.textContent =
            `❌ ${error.message}`;

    } finally {

        dryRunButton.disabled =
            false;

        dryRunButton.textContent =
            "🧪 Analyze Without Calling";

    }

}


// ==================================================
// INITIAL LOAD
// ==================================================

loadSignatures();