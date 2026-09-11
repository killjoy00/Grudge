import { NextRequest, NextResponse } from 'next/server';

import { asPublic } from '../../../lib/db.ts';
import {
  SCHEMA_CONTRACT_VERSION,
  SCHEMA_PROBE_SQL,
  missingSchemaRequirements,
  schemaProbeOk,
  type SchemaProbeRow,
} from '../../../lib/schema-contract.ts';

export const dynamic = 'force-dynamic';

/**
 * The deploy gate only needs the three booleans below to decide whether
 * production is serving the right commit against the right schema. The names
 * of the schema objects that are missing are useful when a deploy fails, but
 * they describe internal structure to an unauthenticated caller, so they are
 * returned only to a caller that presents HEALTH_DETAIL_TOKEN. Everyone else
 * gets the count, which is enough to see that something is wrong.
 */
function detailAllowed(request: NextRequest): boolean {
  const token = process.env.HEALTH_DETAIL_TOKEN;
  return Boolean(token) && request.headers.get('x-health-token') === token;
}

export async function GET(request: NextRequest) {
  const expected = request.nextUrl.searchParams.get('expected');
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown';
  const detail = detailAllowed(request);

  try {
    const [schema] = await asPublic<SchemaProbeRow>(SCHEMA_PROBE_SQL);
    const schemaOk = schemaProbeOk(schema);
    const commitOk = !expected || expected === commit;
    const ok = schemaOk && commitOk;

    return NextResponse.json(
      {
        ok,
        commit,
        commitOk,
        schemaOk,
        schemaVersion: SCHEMA_CONTRACT_VERSION,
        missingCount: schemaOk ? 0 : missingSchemaRequirements(schema).length,
        ...(detail ? { missing: schemaOk ? [] : missingSchemaRequirements(schema) } : {}),
      },
      { status: ok ? 200 : commitOk ? 503 : 409 }
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        commit,
        commitOk: !expected || expected === commit,
        schemaOk: false,
        schemaVersion: SCHEMA_CONTRACT_VERSION,
        missingCount: 1,
        ...(detail ? { missing: ['database probe failed'] } : {}),
      },
      { status: 503 }
    );
  }
}
