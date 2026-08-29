function analyzeTranscript(transcript = "") {

    // --------------------------------------------------
    // Only analyze what the CALLER / USER said.
    // Ignore BOT questions so the investigator's
    // vocabulary does not create false positives.
    // --------------------------------------------------

    const callerLines = transcript
        .split("\n")
        .filter(line => line.includes("USER:"))
        .map(line =>
            line.substring(line.indexOf("USER:") + 5)
        )
        .join(" ")
        .toLowerCase()
        .trim();


    const text = callerLines;


    const indicators = [];
    const signatureParts = [];

    let score = 0;


    function addIndicator(
        type,
        description,
        severity,
        points
    ) {

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
        text.includes("bank") ||
        text.includes("credit card") ||
        text.includes("debit card") ||
        text.includes("bank account") ||
        text.includes("account")
    ) {

        addIndicator(
            "FINANCIAL_CONTEXT",

            "Caller claimed or referenced a bank, financial account, or payment instrument.",

            "MEDIUM",

            10
        );

        signatureParts.push(
            "FINANCIAL_CONTEXT"
        );

    }


    // ==================================================
    // KYC
    // ==================================================

    if (
        text.includes("kyc") ||
        text.includes("know your customer") ||
        text.includes("kyc verification") ||
        text.includes("kyc department")
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
    // OTP
    // ==================================================

    if (
        text.includes("otp") ||
        text.includes("one time password") ||
        text.includes("verification code") ||
        text.includes("otp receipt") ||
        text.includes("code you received")
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
    // CREDENTIALS
    // ==================================================

    if (
        text.includes("your password") ||
        text.includes("my password") ||
        text.includes("tell me your password") ||
        text.includes("give me your password") ||
        text.includes("pin number") ||
        text.includes("tell me your pin") ||
        text.includes("give me your pin") ||
        text.includes("cvv number") ||
        text.includes("tell me your cvv") ||
        text.includes("give me your cvv") ||
        text.includes("card number")
    ) {

        addIndicator(
            "CREDENTIAL_REQUEST",

            "Caller requested sensitive financial credentials.",

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
        text.includes("immediately") ||
        text.includes("urgent") ||
        text.includes("right now") ||
        text.includes("today") ||
        text.includes("within an hour") ||
        text.includes("act now") ||
        text.includes("as soon as possible")
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
    // THREATS
    // ==================================================

    if (
        text.includes("account will be blocked") ||
        text.includes("account will close") ||
        text.includes("account will be closed") ||
        text.includes("blocked today") ||
        text.includes("legal action") ||
        text.includes("you will be arrested") ||
        text.includes("police complaint") ||
        text.includes("penalty")
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
        text.includes("send money") ||
        text.includes("transfer money") ||
        text.includes("make a payment") ||
        text.includes("pay the fee") ||
        text.includes("pay us") ||
        text.includes("upi payment") ||
        text.includes("upi transfer") ||
        text.includes("deposit money") ||
        text.includes("send the money")
    ) {

        addIndicator(
            "PAYMENT_REQUEST",

            "Caller requested or instructed the recipient to send money.",

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
        text.includes("anydesk") ||
        text.includes("teamviewer") ||
        text.includes("remote access") ||
        text.includes("screen sharing") ||
        text.includes("share your screen") ||
        text.includes("install this app")
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
    // FAKE JOB
    // ==================================================

    if (
        (
            text.includes("job") ||
            text.includes("recruitment") ||
            text.includes("work from home") ||
            text.includes("salary")
        ) &&
        (
            text.includes("fee") ||
            text.includes("registration") ||
            text.includes("deposit") ||
            text.includes("payment")
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
    // NORMALIZE SCORE
    // ==================================================

    score = Math.min(
        score,
        100
    );


    // ==================================================
    // RISK LEVEL
    // ==================================================

    let riskLevel = "LOW";


    if (score >= 70) {

        riskLevel = "HIGH";

    } else if (score >= 30) {

        riskLevel = "MEDIUM";

    }


    // ==================================================
    // SCAM TYPE
    // ==================================================

    let scamType =
        "No specific scam pattern identified";


    if (
        signatureParts.includes("KYC") &&
        signatureParts.includes("OTP_REQUEST")
    ) {

        scamType =
            "Potential Fake KYC / Bank Impersonation";

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
        signatureParts.includes("FINANCIAL_CONTEXT")
    ) {

        scamType =
            "Potential Financial Impersonation";

    }


    // ==================================================
    // UNIQUE SCAM SIGNATURE
    // ==================================================

    const uniqueSignature =
        [...new Set(signatureParts)];


    const scamSignature =
        uniqueSignature.length > 0
            ? uniqueSignature.join(" + ")
            : "NO_STRONG_SIGNATURE";


    // ==================================================
    // CONFIDENCE
    // ==================================================

    let confidence = 45;


    if (indicators.length >= 2) {

        confidence += 15;

    }


    if (indicators.length >= 4) {

        confidence += 15;

    }


    if (riskLevel === "HIGH") {

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


    if (riskLevel === "MEDIUM") {

        recommendation =
            "Exercise caution. Independently verify the caller through an official website or trusted phone number before taking action.";

    }


    if (riskLevel === "HIGH") {

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