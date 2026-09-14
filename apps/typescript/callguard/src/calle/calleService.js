const { execFile } = require("child_process");
const path = require("path");


// --------------------------------------------------
// CALL-E CONFIGURATION
// --------------------------------------------------

// Use the Node executable that is already running
// this server.
const NODE_EXECUTABLE =
    process.execPath;


// CALL-E CLI JavaScript entry point installed
// globally by npm.
const CALLE_JS =
    path.join(
        process.env.APPDATA || "",
        "npm",
        "node_modules",
        "@call-e",
        "cli",
        "bin",
        "calle.js"
    );


// --------------------------------------------------
// CALL-E SERVER
// --------------------------------------------------
//
// The default is the CALL-E server currently used
// by this integration.
//
// A custom URL is allowed only when it is explicitly
// listed as an approved CALL-E host.
//
// This prevents the application from accidentally
// sending CALL-E credentials to an arbitrary server.
//

const DEFAULT_CALLE_SERVER_URL =
    "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";


const CALLE_SERVER_URL =
    process.env.CALLE_SERVER_URL ||
    DEFAULT_CALLE_SERVER_URL;


// Only these hosts are accepted.
//
// Additional hosts can be explicitly approved through:
//
// CALLE_ALLOWED_SERVER_HOSTS
//
// Example:
// CALLE_ALLOWED_SERVER_HOSTS=another-approved-host.example
//

const DEFAULT_ALLOWED_HOSTS = new Set([

    "seleven-mcp-sg.airudder.com"

]);


const configuredAdditionalHosts =
    (process.env.CALLE_ALLOWED_SERVER_HOSTS || "")
        .split(",")
        .map(
            value => value.trim().toLowerCase()
        )
        .filter(Boolean);


for (
    const host
    of configuredAdditionalHosts
) {

    DEFAULT_ALLOWED_HOSTS.add(
        host
    );

}


// --------------------------------------------------
// CALL-E CLI AUTHENTICATION CACHE
// --------------------------------------------------

const CALLE_CACHE_ROOT =
    process.env.CALLE_CACHE_ROOT ||
    path.join(
        process.env.USERPROFILE || "",
        ".calle-mcp",
        "cli"
    );


// --------------------------------------------------
// VALIDATE CALL-E CONFIGURATION
// --------------------------------------------------

function validateConfiguration() {

    if (!CALLE_JS) {

        throw new Error(
            "CALL-E CLI path is not configured."
        );

    }


    let parsedUrl;


    try {

        parsedUrl =
            new URL(
                CALLE_SERVER_URL
            );

    } catch (error) {

        throw new Error(
            "CALL-E server URL is invalid."
        );

    }


    // HTTPS only.
    if (
        parsedUrl.protocol !== "https:"
    ) {

        throw new Error(
            "CALL-E server URL must use HTTPS."
        );

    }


    const hostname =
        parsedUrl.hostname
            .toLowerCase();


    // Only approved CALL-E hosts.
    if (
        !DEFAULT_ALLOWED_HOSTS.has(
            hostname
        )
    ) {

        throw new Error(
            "CALL-E server URL is not an approved CALL-E host."
        );

    }


    // Prevent embedded credentials.
    if (
        parsedUrl.username ||
        parsedUrl.password
    ) {

        throw new Error(
            "CALL-E server URL must not contain embedded credentials."
        );

    }

}


// --------------------------------------------------
// RUN CALL-E DIRECTLY THROUGH NODE
// --------------------------------------------------

function runCalle(
    args
) {

    validateConfiguration();


    return new Promise(
        (
            resolve,
            reject
        ) => {

            console.log(
                "\nRunning CALL-E...\n"
            );


            execFile(

                NODE_EXECUTABLE,

                [
                    CALLE_JS,
                    ...args
                ],

                {
                    windowsHide: true,

                    maxBuffer:
                        10 * 1024 * 1024,

                    timeout:
                        180000
                },

                (
                    error,
                    stdout,
                    stderr
                ) => {

                    if (error) {

                        console.error(
                            "CALL-E request failed."
                        );


                        reject(
                            new Error(
                                stderr ||
                                stdout ||
                                error.message
                            )
                        );


                        return;

                    }


                    try {

                        const result =
                            JSON.parse(
                                stdout
                            );


                        resolve(
                            result
                        );


                    } catch (
                        parseError
                    ) {

                        console.error(
                            "CALL-E returned an invalid response."
                        );


                        reject(
                            new Error(
                                "Could not parse CALL-E response."
                            )
                        );

                    }

                }

            );

        }
    );

}


// --------------------------------------------------
// START CALL-E INVESTIGATION
// --------------------------------------------------

async function startCall(
    phoneNumber,
    goal
) {

    return runCalle([

        "call",
        "start",

        "--to-phone",
        phoneNumber,

        "--goal",
        goal,

        "--language",
        "English",

        "--region",
        "IN",

        "--timezone",
        "Asia/Kolkata",

        "--server-url",
        CALLE_SERVER_URL,

        "--cache-root",
        CALLE_CACHE_ROOT

    ]);

}


// --------------------------------------------------
// GET CALL-E INVESTIGATION STATUS
// --------------------------------------------------

async function getCallStatus(
    runId
) {

    if (
        !runId ||
        typeof runId !== "string"
    ) {

        throw new Error(
            "A valid CALL-E run ID is required."
        );

    }


    return runCalle([

        "call",
        "status",

        "--run-id",
        runId,

        "--timezone",
        "Asia/Kolkata",

        "--server-url",
        CALLE_SERVER_URL,

        "--cache-root",
        CALLE_CACHE_ROOT

    ]);

}


// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

module.exports = {

    startCall,

    getCallStatus

};