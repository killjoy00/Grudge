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

export async function GET(request: NextRequest) {
  const expected = request.nextUrl.searchParams.get('expected');
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown';

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
        missing: schemaOk ? [] : missingSchemaRequirements(schema),
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
        missing: ['database probe failed'],
      },
      { status: 503 }
    );
  }
}
