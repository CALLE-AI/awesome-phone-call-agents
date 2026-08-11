import { readFile } from 'node:fs/promises'
import { buildCallInput, createSdkPort, dispatchStoryCall, summarizeCallSnapshot } from '../server/calle.js'
import type { StoryCallRequest } from '../server/call-contract.js'

const [command, requestPath] = process.argv.slice(2)
if (!requestPath || !['preview', 'live'].includes(command ?? '')) {
  console.error('Usage: npm run call:preview -- <request.json> | npm run call:live -- <request.json>')
  process.exit(2)
}

const request = JSON.parse(await readFile(requestPath, 'utf8')) as StoryCallRequest
if (command === 'preview') {
  const preview = buildCallInput(request)
  console.log(JSON.stringify({ ...preview, recipients: '[redacted in preview]' }, null, 2))
  process.exit(0)
}

const port = await createSdkPort()
const result = await dispatchStoryCall(request, port)
console.log(JSON.stringify(summarizeCallSnapshot(result), null, 2))
