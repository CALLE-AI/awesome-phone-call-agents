const { execFile } = require("child_process");
const path = require("path");

// Use the Node executable that is already running this server.
const NODE_EXECUTABLE = process.execPath;

// CALL-E CLI JavaScript entry point installed globally by npm.
const CALLE_JS = path.join(
    process.env.APPDATA,
    "npm",
    "node_modules",
    "@call-e",
    "cli",
    "bin",
    "calle.js"
);


// --------------------------------------------------
// Run CALL-E directly through Node
// --------------------------------------------------

function runCalle(args) {

    return new Promise((resolve, reject) => {

        console.log("\n▶ Running CALL-E...\n");

        execFile(
            NODE_EXECUTABLE,
            [
                CALLE_JS,
                ...args
            ],
            {
                windowsHide: true,
                maxBuffer: 10 * 1024 * 1024,
                timeout: 180000
            },
            (error, stdout, stderr) => {

                if (error) {

                    console.error(
                        "CALL-E stderr:",
                        stderr
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
                        JSON.parse(stdout);

                    resolve(result);

                } catch (parseError) {

                    console.error(
                        "CALL-E raw output:",
                        stdout
                    );

                    reject(
                        new Error(
                            `Could not parse CALL-E response:\n${stdout}`
                        )
                    );

                }

            }
        );

    });

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
        "Asia/Kolkata"

    ]);

}


// --------------------------------------------------
// Get CALL-E investigation status
// --------------------------------------------------

async function getCallStatus(runId) {

    return runCalle([

        "call",
        "status",

        "--run-id",
        runId,

        "--timezone",
        "Asia/Calcutta",

        "--server-url",
        "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth",

        "--cache-root",
        path.join(
            process.env.USERPROFILE,
            ".calle-mcp",
            "cli"
        )

    ]);

}


module.exports = {

    startCall,

    getCallStatus

};