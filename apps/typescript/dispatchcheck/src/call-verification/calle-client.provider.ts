import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CalleClient as CalleClientType } from '@call-e/calle';

export const CALLE_CLIENT = 'CALLE_CLIENT';

/**
 * @call-e/calle ships as an ESM-only package ("type": "module"), while this
 * NestJS project compiles to CommonJS. A plain `import()` looks async but
 * `tsc` still silently downlevels it to `require()` under a CommonJS target,
 * which throws ERR_REQUIRE_ESM at runtime for an ESM-only package.
 *
 * The standard workaround is to build the import call via `new Function(...)`
 * so it's invisible to TypeScript's transpiler and survives as a real
 * dynamic `import()` at runtime. Verified against the actual compiled
 * output in dist/ - see project notes.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@call-e/calle')>;

export const CalleClientProvider: Provider = {
  provide: CALLE_CLIENT,
  useFactory: async (config: ConfigService): Promise<CalleClientType> => {
    const apiKey = config.get<string>('CALLE_API_KEY');
    if (!apiKey) {
      throw new Error(
        'CALLE_API_KEY is not set. Copy .env.example to .env and add your CALL-E API key.',
      );
    }
    const { CalleClient } = await dynamicImport('@call-e/calle');
    return new CalleClient({ apiKey });
  },
  inject: [ConfigService],
};
