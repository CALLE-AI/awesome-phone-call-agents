let currentRunId = null;
let statusTimer = null;


// ==================================================
// ELEMENTS
// ==================================================

const phoneInput =
    document.getElementById("phoneNumber");

const investigateButton =
    document.getElementById("investigateButton");

const statusBox =
    document.getElementById("status");

const report =
    document.getElementById("report");


// ==================================================
// STATUS MESSAGE
// ==================================================

function showStatus(
    message,
    type = "info"
) {

    statusBox.className =
        `status ${type}`;

    statusBox.textContent =
        message;

}


function hideStatus() {

    statusBox.className =
        "status hidden";

}


// ==================================================
// INVESTIGATE CALL
// ==================================================

async function investigateCall() {

    const phoneNumber =
        phoneInput.value.trim();


    if (!phoneNumber) {

        showStatus(
            "Please enter a phone number.",
            "error"
        );

        return;

    }


    investigateButton.disabled =
        true;

    investigateButton.textContent =
        "📞 Starting investigation...";


    report.classList.add(
        "hidden"
    );


    showStatus(
        "📞 CallGuard is preparing a real CALL-E investigation...",
        "info"
    );


    try {

        const response =
            await fetch(
                "/api/investigate",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        phoneNumber
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok || !data.ok) {

            throw new Error(
                data.error ||
                "Investigation could not be started."
            );

        }


        currentRunId =
            data.runId;


        showStatus(
            "📞 CALL-E is calling the number. Please answer your phone...",
            "info"
        );


        investigateButton.textContent =
            "📞 Call in progress...";


        pollInvestigation();


    } catch (error) {

        console.error(error);


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
                `/api/investigate/${encodeURIComponent(currentRunId)}`
            );


        const data =
            await response.json();


        if (!response.ok || !data.ok) {

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
            status === "IN_PROGRESS"
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
            status === "ERROR"
        ) {

            throw new Error(
                data.error ||
                "CALL-E investigation failed."
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

        console.error(error);


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


    document.getElementById(
        "riskLevel"
    ).textContent =
        riskLevel;


    document.getElementById(
        "riskScore"
    ).textContent =
        riskScore;


    const riskCard =
        document.getElementById(
            "riskCard"
        );


    riskCard.className =
        `risk-card ${riskLevel.toLowerCase()}`;


    // ------------------------------------------
    // Scam Type
    // ------------------------------------------

    document.getElementById(
        "scamType"
    ).textContent =
        analysis.scamType ||
        "No specific scam pattern identified";


    // ------------------------------------------
    // Signature
    // ------------------------------------------

    document.getElementById(
        "scamSignature"
    ).textContent =
        analysis.scamSignature ||
        "NO_STRONG_SIGNATURE";


    // ------------------------------------------
    // Recommendation
    // ------------------------------------------

    document.getElementById(
        "recommendation"
    ).textContent =
        analysis.recommendation ||
        "Exercise caution and verify the caller independently.";


    // ------------------------------------------
    // Summary
    // ------------------------------------------

    document.getElementById(
        "callSummary"
    ).textContent =
        data.summary ||
        data.callSummary ||
        "No summary available.";


    // ------------------------------------------
    // Indicators
    // ------------------------------------------

    const indicatorContainer =
        document.getElementById(
            "indicators"
        );


    indicatorContainer.innerHTML =
        "";


    const indicators =
        analysis.indicators ||
        [];


    indicators.forEach(
        indicator => {

            const element =
                document.createElement(
                    "div"
                );


            element.className =
                "indicator";


            element.innerHTML = `
                <span>🚩</span>
                <div>
                    <strong>${escapeHtml(indicator.type)}</strong>
                    <p>${escapeHtml(indicator.description)}</p>
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


    transcriptContainer.innerHTML =
        "";


    const transcript =
        data.transcript ||
        analysis.transcript ||
        "";


    if (transcript) {

        transcript
            .split("\n")
            .forEach(
                line => {

                    if (!line.trim()) {
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
                        .appendChild(element);

                }
            );

    } else {

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
        data.signatureMatch &&
        data.signatureMatch.occurrences > 1
    ) {

        matchCard.classList.remove(
            "hidden"
        );


        document.getElementById(
            "matchMessage"
        ).textContent =
            `This scam pattern has been observed ${data.signatureMatch.occurrences} times.`;

    } else {

        matchCard.classList.add(
            "hidden"
        );

    }


    // Scroll to report

    report.scrollIntoView({
        behavior: "smooth"
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
                "/api/signatures"
            );


        const data =
            await response.json();


        if (!data.ok) {

            throw new Error(
                "Could not load signatures."
            );

        }


        const signatures =
            data.signatures ||
            [];


        count.textContent =
            `${signatures.length} known scam pattern${signatures.length === 1 ? "" : "s"}`;


        list.innerHTML =
            "";


        if (signatures.length === 0) {

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
                                ${escapeHtml(signature.riskLevel)}
                            </span>

                            <span>
                                Seen ${signature.occurrences} time${signature.occurrences === 1 ? "" : "s"}
                            </span>

                        </div>


                        <h3>
                            ${escapeHtml(signature.scamType)}
                        </h3>


                        <code>
                            ${escapeHtml(signature.signature)}
                        </code>


                        <p>
                            ${escapeHtml(signature.latestSummary || "No summary available.")}
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


        count.textContent =
            "Intelligence unavailable";

    }

}


// ==================================================
// HTML ESCAPING
// ==================================================

function escapeHtml(
    value
) {

    return String(value)
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
// INITIAL LOAD
// ==================================================

loadSignatures();