function analyzeTranscript(transcript = "") {

    // ==================================================
    // NORMALIZE TRANSCRIPT
    // ==================================================

    const rawTranscript =
        String(transcript || "")
            .trim();


    // ==================================================
    // EXTRACT CALLER SPEECH
    // ==================================================
    //
    // Supports different transcript formats:
    //
    // Caller: ...
    // USER: ...
    // Agent: ...
    // Assistant: ...
    //
    // We primarily analyze the caller's speech so that
    // the investigator's own questions do not create
    // false positives.
    // ==================================================

    const lines =
        rawTranscript
            .split(/\r?\n/);


    const callerParts = [];


    let currentSpeaker =
        null;


    for (
        const line of lines
    ) {

        const trimmed =
            line.trim();


        if (!trimmed) {

            continue;

        }


        // ------------------------------------------
        // Caller / USER
        // ------------------------------------------

        if (
            /^(caller|user|callee|customer|recipient\s*\/?\s*caller)\s*:/i
                .test(trimmed)
        ) {

            currentSpeaker =
                "caller";


            const content =
                trimmed.replace(
                    /^(caller|user|callee|customer|recipient\s*\/?\s*caller)\s*:\s*/i,
                    ""
                );


            if (content) {

                callerParts.push(
                    content
                );

            }


            continue;

        }


        // ------------------------------------------
        // Investigator / Agent / Assistant
        // ------------------------------------------

        if (
            /^(agent|assistant|bot|callguard|ai)\s*:/i
                .test(trimmed)
        ) {

            currentSpeaker =
                "agent";


            continue;

        }


        // ------------------------------------------
        // Continuation of previous speaker
        // ------------------------------------------

        if (
            currentSpeaker === "caller"
        ) {

            callerParts.push(
                trimmed
            );

        }

    }


    // ==================================================
    // FALLBACK
    // ==================================================
    //
    // If the transcript doesn't contain recognizable
    // speaker labels, analyze the entire transcript.
    //
    // This keeps the dry-run useful with pasted text.
    // ==================================================

    let callerText =
        callerParts.join(" ");


    if (!callerText) {

        callerText =
            rawTranscript;

    }


    const text =
        callerText
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();


    // ==================================================
    // ANALYSIS STATE
    // ==================================================

    const indicators = [];

    const signatureParts = [];

    let score = 0;


    // ==================================================
    // ADD INDICATOR
    // ==================================================

    function addIndicator(
        type,
        description,
        severity,
        points
    ) {

        // Prevent duplicate indicators.

        const alreadyExists =
            indicators.some(
                indicator =>
                    indicator.type === type
            );


        if (alreadyExists) {

            return;

        }


        indicators.push({

            type,

            description,

            severity,

            points

        });


        score += points;

    }


    // ==================================================
    // FINANCIAL / BANK CONTEXT
    // ==================================================

    if (
        /\bbank\b/.test(text) ||
        /\bbanking\b/.test(text) ||
        /bank account/.test(text) ||
        /credit card/.test(text) ||
        /debit card/.test(text) ||
        /financial account/.test(text) ||
        /financial service/.test(text) ||
        /account verification/.test(text)
    ) {

        addIndicator(

            "FINANCIAL_CONTEXT",

            "Caller claimed or referenced a bank, financial account, or financial service.",

            "MEDIUM",

            10

        );


        signatureParts.push(
            "FINANCIAL_CONTEXT"
        );

    }


    // ==================================================
    // ORGANIZATION / IMPERSONATION
    // ==================================================

    if (
        /verification department/.test(text) ||
        /bank department/.test(text) ||
        /bank representative/.test(text) ||
        /customer care/.test(text) ||
        /support department/.test(text) ||
        /official department/.test(text) ||
        /account department/.test(text)
    ) {

        addIndicator(

            "ORGANIZATION_CLAIM",

            "Caller claimed to represent an organization or department.",

            "MEDIUM",

            10

        );


        signatureParts.push(
            "ORGANIZATION_CLAIM"
        );

    }


    // ==================================================
    // KYC
    // ==================================================

    if (
        /\bkyc\b/.test(text) ||
        /know your customer/.test(text) ||
        /kyc verification/.test(text) ||
        /kyc department/.test(text) ||
        /identity verification/.test(text) ||
        /identity verification process/.test(text)
    ) {

        addIndicator(

            "KYC_CLAIM",

            "Caller used a KYC or identity-verification claim.",

            "MEDIUM",

            15

        );


        signatureParts.push(
            "KYC"
        );

    }


    // ==================================================
    // ACCOUNT VERIFICATION
    // ==================================================

    if (
        /verify your account/.test(text) ||
        /verify the account/.test(text) ||
        /account verification/.test(text) ||
        /verify your identity/.test(text) ||
        /complete verification/.test(text) ||
        /complete an urgent verification/.test(text)
    ) {

        addIndicator(

            "ACCOUNT_VERIFICATION",

            "Caller requested or discussed urgent account or identity verification.",

            "MEDIUM",

            15

        );


        signatureParts.push(
            "ACCOUNT_VERIFICATION"
        );

    }


    // ==================================================
    // OTP / VERIFICATION CODE
    // ==================================================

    if (
        /\botp\b/.test(text) ||
        /one time password/.test(text) ||
        /one-time password/.test(text) ||
        /verification code/.test(text) ||
        /security code/.test(text) ||
        /verification number/.test(text) ||
        /code you received/.test(text) ||
        /code received/.test(text) ||
        /share the code/.test(text) ||
        /tell me the code/.test(text)
    ) {

        addIndicator(

            "OTP_REQUEST",

            "Caller requested or attempted to obtain a one-time verification code.",

            "HIGH",

            30

        );


        signatureParts.push(
            "OTP_REQUEST"
        );

    }


    // ==================================================
    // PASSWORD / PIN / CVV / CREDENTIALS
    // ==================================================

    if (
        /your password/.test(text) ||
        /my password/.test(text) ||
        /tell me your password/.test(text) ||
        /give me your password/.test(text) ||
        /\bpin\b/.test(text) ||
        /pin number/.test(text) ||
        /tell me your pin/.test(text) ||
        /give me your pin/.test(text) ||
        /\bcvv\b/.test(text) ||
        /cvv number/.test(text) ||
        /tell me your cvv/.test(text) ||
        /give me your cvv/.test(text) ||
        /card number/.test(text) ||
        /account password/.test(text) ||
        /login details/.test(text) ||
        /banking credentials/.test(text)
    ) {

        addIndicator(

            "CREDENTIAL_REQUEST",

            "Caller requested or attempted to obtain sensitive credentials.",

            "HIGH",

            30

        );


        signatureParts.push(
            "CREDENTIAL_REQUEST"
        );

    }


    // ==================================================
    // URGENCY
    // ==================================================

    if (
        /\bimmediately\b/.test(text) ||
        /\burgent\b/.test(text) ||
        /right now/.test(text) ||
        /\btoday\b/.test(text) ||
        /within an hour/.test(text) ||
        /act now/.test(text) ||
        /as soon as possible/.test(text) ||
        /without delay/.test(text) ||
        /immediate action/.test(text) ||
        /do this now/.test(text)
    ) {

        addIndicator(

            "URGENCY",

            "Caller pressured the recipient to take immediate action.",

            "MEDIUM",

            15

        );


        signatureParts.push(
            "URGENCY"
        );

    }


    // ==================================================
    // ACCOUNT SUSPENSION / THREATS
    // ==================================================

    if (
        /account will be blocked/.test(text) ||
        /account will be closed/.test(text) ||
        /account will close/.test(text) ||
        /account may be suspended/.test(text) ||
        /account will be suspended/.test(text) ||
        /account may get suspended/.test(text) ||
        /account gets suspended/.test(text) ||
        /account has been suspended/.test(text) ||
        /account is suspended/.test(text) ||
        /blocked today/.test(text) ||
        /account blocked/.test(text) ||
        /account suspension/.test(text) ||
        /legal action/.test(text) ||
        /you will be arrested/.test(text) ||
        /police complaint/.test(text) ||
        /\bpenalty\b/.test(text) ||
        /service will be stopped/.test(text)
    ) {

        addIndicator(

            "ACCOUNT_THREAT",

            "Caller used a threat or negative consequence to pressure the recipient.",

            "HIGH",

            25

        );


        signatureParts.push(
            "ACCOUNT_THREAT"
        );

    }


    // ==================================================
    // PAYMENT
    // ==================================================

    if (
        /send money/.test(text) ||
        /transfer money/.test(text) ||
        /make a payment/.test(text) ||
        /pay the fee/.test(text) ||
        /pay us/.test(text) ||
        /upi payment/.test(text) ||
        /upi transfer/.test(text) ||
        /deposit money/.test(text) ||
        /send the money/.test(text) ||
        /pay immediately/.test(text) ||
        /processing fee/.test(text) ||
        /registration fee/.test(text)
    ) {

        addIndicator(

            "PAYMENT_REQUEST",

            "Caller requested or instructed the recipient to send money or make a payment.",

            "HIGH",

            25

        );


        signatureParts.push(
            "PAYMENT"
        );

    }


    // ==================================================
    // REMOTE ACCESS
    // ==================================================

    if (
        /anydesk/.test(text) ||
        /teamviewer/.test(text) ||
        /remote access/.test(text) ||
        /remote control/.test(text) ||
        /screen sharing/.test(text) ||
        /share your screen/.test(text) ||
        /install this app/.test(text) ||
        /download this app/.test(text) ||
        /install an application/.test(text)
    ) {

        addIndicator(

            "REMOTE_ACCESS",

            "Caller requested or encouraged remote access to the recipient's device.",

            "HIGH",

            30

        );


        signatureParts.push(
            "REMOTE_ACCESS"
        );

    }


    // ==================================================
    // FAKE JOB / RECRUITMENT
    // ==================================================

    if (
        (
            /\bjob\b/.test(text) ||
            /recruitment/.test(text) ||
            /work from home/.test(text) ||
            /\bsalary\b/.test(text) ||
            /job offer/.test(text)
        ) &&
        (
            /\bfee\b/.test(text) ||
            /registration/.test(text) ||
            /deposit/.test(text) ||
            /payment/.test(text) ||
            /processing charge/.test(text)
        )
    ) {

        addIndicator(

            "FAKE_JOB_PATTERN",

            "Caller combined a job or recruitment claim with a payment-related request.",

            "HIGH",

            30

        );


        signatureParts.push(
            "FAKE_JOB"
        );

    }


    // ==================================================
    // INDEPENDENT VERIFICATION
    // ==================================================

    if (
        /verify independently/.test(text) ||
        /verify through official/.test(text) ||
        /official website/.test(text) ||
        /official number/.test(text) ||
        /independently verify/.test(text)
    ) {

        addIndicator(

            "VERIFICATION_DISCUSSION",

            "The conversation involved discussion of independently verifying the caller through an official channel.",

            "LOW",

            5

        );


        signatureParts.push(
            "VERIFICATION_DISCUSSION"
        );

    }


    // ==================================================
    // NORMALIZE SCORE
    // ==================================================

    score =
        Math.min(
            score,
            100
        );


    // ==================================================
    // RISK LEVEL
    // ==================================================

    let riskLevel =
        "LOW";


    if (
        score >= 70
    ) {

        riskLevel =
            "HIGH";

    } else if (
        score >= 30
    ) {

        riskLevel =
            "MEDIUM";

    }


    // ==================================================
    // SCAM TYPE
    // ==================================================

    let scamType =
        "No specific scam pattern identified";


    if (
        signatureParts.includes("KYC") &&
        (
            signatureParts.includes("OTP_REQUEST") ||
            signatureParts.includes("ACCOUNT_THREAT") ||
            signatureParts.includes("FINANCIAL_CONTEXT")
        )
    ) {

        scamType =
            "Potential Fake KYC / Bank Impersonation";

    } else if (
        signatureParts.includes("OTP_REQUEST") &&
        signatureParts.includes("FINANCIAL_CONTEXT")
    ) {

        scamType =
            "Potential OTP / Bank Impersonation Scam";

    } else if (
        signatureParts.includes("REMOTE_ACCESS")
    ) {

        scamType =
            "Potential Remote Access Scam";

    } else if (
        signatureParts.includes("FAKE_JOB")
    ) {

        scamType =
            "Potential Fake Job / Recruitment Scam";

    } else if (
        signatureParts.includes("PAYMENT")
    ) {

        scamType =
            "Potential Payment / UPI Scam";

    } else if (
        signatureParts.includes("ACCOUNT_THREAT") &&
        signatureParts.includes("FINANCIAL_CONTEXT")
    ) {

        scamType =
            "Potential Bank / Account Suspension Scam";

    } else if (
        signatureParts.includes("FINANCIAL_CONTEXT")
    ) {

        scamType =
            "Potential Financial Impersonation";

    } else if (
        signatureParts.includes("ACCOUNT_THREAT")
    ) {

        scamType =
            "Potential Account Threat / Impersonation Scam";

    }


    // ==================================================
    // UNIQUE SCAM SIGNATURE
    // ==================================================

    const uniqueSignature =
        [
            ...new Set(
                signatureParts
            )
        ];


    const scamSignature =
        uniqueSignature.length > 0

            ? uniqueSignature.join(
                " + "
            )

            : "NO_STRONG_SIGNATURE";


    // ==================================================
    // CONFIDENCE
    // ==================================================

    let confidence =
        45;


    if (
        indicators.length >= 2
    ) {

        confidence += 15;

    }


    if (
        indicators.length >= 4
    ) {

        confidence += 15;

    }


    if (
        indicators.length >= 6
    ) {

        confidence += 10;

    }


    if (
        riskLevel === "HIGH"
    ) {

        confidence += 15;

    }


    confidence =
        Math.min(
            confidence,
            95
        );


    // ==================================================
    // RECOMMENDATION
    // ==================================================

    let recommendation =
        "No strong scam indicators were detected. Continue exercising caution with unsolicited calls.";


    if (
        riskLevel === "MEDIUM"
    ) {

        recommendation =
            "Exercise caution. Independently verify the caller through an official website or trusted phone number before taking action.";

    }


    if (
        riskLevel === "HIGH"
    ) {

        recommendation =
            "Do not share OTPs, passwords, PINs, CVVs, banking credentials, or remote access. Do not make payments based solely on the call. Verify the organization independently.";

    }


    // ==================================================
    // FINAL REPORT
    // ==================================================

    return {

        riskLevel,

        riskScore:
            score,

        confidence,

        scamType,

        indicators,

        scamSignature,

        recommendation,

        evidenceCount:
            indicators.length,

        analyzedAt:
            new Date().toISOString()

    };

}


module.exports = {
    analyzeTranscript
};