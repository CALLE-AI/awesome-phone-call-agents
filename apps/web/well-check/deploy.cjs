const { execSync } = require('child_process');
require('dotenv').config();
const apiKey = process.env.CALLE_API_KEY;
if (!apiKey) {
    console.error('CALLE_API_KEY is missing.');
    process.exit(1);
}
console.log('Deploying to Cloud Run...');
const cmd = `gcloud run deploy well-check --source . --project well-check-508613 --region us-central1 --allow-unauthenticated --set-env-vars="CALLE_API_KEY=${apiKey}"`;
try {
    execSync(cmd, { stdio: 'inherit' });
    console.log('Deployment complete.');
} catch (err) {
    console.error('Deployment failed.');
    process.exit(1);
}
