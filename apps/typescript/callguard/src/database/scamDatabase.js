const fs = require("fs");
const path = require("path");


// --------------------------------------------------
// Database location
// --------------------------------------------------

const DATA_DIR =
    path.join(__dirname, "../../data");

const DATABASE_FILE =
    path.join(DATA_DIR, "scamSignatures.json");


// --------------------------------------------------
// Ensure database exists
// --------------------------------------------------

function initializeDatabase() {

    if (!fs.existsSync(DATA_DIR)) {

        fs.mkdirSync(
            DATA_DIR,
            {
                recursive: true
            }
        );

    }


    if (!fs.existsSync(DATABASE_FILE)) {

        fs.writeFileSync(
            DATABASE_FILE,
            JSON.stringify(
                [],
                null,
                2
            )
        );

    }

}


// --------------------------------------------------
// Read signatures
// --------------------------------------------------

function getSignatures() {

    initializeDatabase();

    try {

        const content =
            fs.readFileSync(
                DATABASE_FILE,
                "utf8"
            );

        return JSON.parse(content);

    } catch (error) {

        console.error(
            "Could not read scam database:",
            error
        );

        return [];

    }

}


// --------------------------------------------------
// Save signatures
// --------------------------------------------------

function saveSignatures(
    signatures
) {

    initializeDatabase();

    fs.writeFileSync(
        DATABASE_FILE,
        JSON.stringify(
            signatures,
            null,
            2
        )
    );

}


// --------------------------------------------------
// Create a reusable signature
// --------------------------------------------------

function saveScamInvestigation(
    phoneNumber,
    analysis,
    summary
) {

    const signatures =
        getSignatures();


    const signature =
        analysis.scamSignature;


    // Don't save empty signatures
    if (
        !signature ||
        signature === "NO_STRONG_SIGNATURE"
    ) {

        return null;

    }


    // Check whether this signature
    // already exists

    const existing =
        signatures.find(
            item =>
                item.signature === signature
        );


    if (existing) {

        existing.occurrences += 1;

        existing.lastSeen =
            new Date().toISOString();

        existing.latestSummary =
            summary || existing.latestSummary;

        saveSignatures(
            signatures
        );

        return existing;

    }


    // Create new signature

    const newSignature = {

        id:
            `SIG-${Date.now()}`,

        signature,

        scamType:
            analysis.scamType,

        riskLevel:
            analysis.riskLevel,

        riskScore:
            analysis.riskScore,

        confidence:
            analysis.confidence,

        occurrences: 1,

        firstSeen:
            new Date().toISOString(),

        lastSeen:
            new Date().toISOString(),

        latestSummary:
            summary || "",

        // Privacy:
        // Never store the investigated phone number.
        sourcePhone:
            null

    };


    signatures.push(
        newSignature
    );


    saveSignatures(
        signatures
    );


    return newSignature;

}


// --------------------------------------------------
// Find matching signature
// --------------------------------------------------

function findSignature(
    signature
) {

    const signatures =
        getSignatures();


    return signatures.find(
        item =>
            item.signature === signature
    ) || null;

}


// --------------------------------------------------
// Get all signatures
// --------------------------------------------------

function getAllSignatures() {

    return getSignatures();

}


module.exports = {

    saveScamInvestigation,

    findSignature,

    getAllSignatures

};