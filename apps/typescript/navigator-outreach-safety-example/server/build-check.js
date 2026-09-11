import { mkdirSync, writeFileSync } from 'node:fs'
import { verifyCallEImport } from './callEImport.js'

const lockedEnvironment = {
  CALL_EXECUTION_ENABLED: 'false',
  CONTROLLED_CALL_GO: 'false',
  MAXIMUM_CALLS: '0',
  SHUTDOWN_ACTIVE: 'true',
}

const result = verifyCallEImport(lockedEnvironment)
mkdirSync('dist', { recursive: true })
writeFileSync('dist/build-verification.json', `${JSON.stringify(result, null, 2)}\n`)
console.log('BUILD_OK: CALL-E imported under the permanent no-call lock')
