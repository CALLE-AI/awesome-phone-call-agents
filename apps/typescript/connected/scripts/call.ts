import { readFile } from 'node:fs/promises'
import { buildCallInput, createSdkPort, dispatchCheckIn, publicSummary } from '../server/calle.js'
import { parseCheckInRequest } from '../server/contract.js'

const [command, requestPath] = process.argv.slice(2)
if (!requestPath || !['preview', 'live'].includes(command ?? '')) {
  console.error('Usage: npm run call:preview -- <request.json> | npm run call:live -- <request.json>')
  process.exit(2)
}

const request = parseCheckInRequest(JSON.parse(await readFile(requestPath, 'utf8')))
if (command === 'preview') {
  console.log(JSON.stringify({ ...buildCallInput(request), recipients: '[redacted in preview]' }, null, 2))
  process.exit(0)
}
const result = await dispatchCheckIn(request, await createSdkPort())
console.log(JSON.stringify(publicSummary(result), null, 2))
