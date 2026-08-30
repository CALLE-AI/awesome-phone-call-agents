const { execFile } = require("child_process");
const path = require("path");


// --------------------------------------------------
// CALL-E configuration
// --------------------------------------------------

// Use the Node executable that is already running this server.
const NODE_EXECUTABLE =
    process.execPath;


// CALL-E CLI JavaScript entry point installed globally by npm.
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


// Official CALL-E server.
// Can be overridden explicitly through the environment.
const CALLE_SERVER_URL =
    process.env.CALLE_SERVER_URL ||
    "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth";


// CALL-E CLI authentication cache.
// Defaults to the standard local CLI location.
const CALLE_CACHE_ROOT =
    process.env.CALLE_CACHE_ROOT ||
    path.join(
        process.env.USERPROFILE || "",
        ".calle-mcp",
        "cli"
    );


// --------------------------------------------------
// Validate CALL-E configuration
// --------------------------------------------------

function validateConfiguration() {

    if (!CALLE_JS) {

        throw new Error(
            "CALL-E CLI path is not configured."
        );

    }


    if (
        !CALLE_SERVER_URL.startsWith(
            "https://"
        )
    ) {

        throw new Error(
            "CALL-E server URL must use HTTPS."
        );

    }

}


// --------------------------------------------------
// Run CALL-E directly through Node
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
// Start CALL-E investigation
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
// Get CALL-E investigation status
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
// Exports
// --------------------------------------------------

module.exports = {

    startCall,

    getCallStatus

};