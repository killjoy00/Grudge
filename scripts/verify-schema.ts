import { connect } from '../pipeline/db.ts';
import {
  SCHEMA_CONTRACT_VERSION,
  SCHEMA_PROBE_SQL,
  missingSchemaRequirements,
  schemaProbeOk,
  type SchemaProbeRow,
} from '../lib/schema-contract.ts';

const sql = connect();
const rows = await (sql as unknown as {
  query: (text: string, params: unknown[]) => Promise<SchemaProbeRow[]>;
}).query(SCHEMA_PROBE_SQL, []);
const row = rows[0];

if (!schemaProbeOk(row)) {
  throw new Error(
    `Database does not satisfy schema contract ${SCHEMA_CONTRACT_VERSION}. Missing: ${missingSchemaRequirements(row).join(', ')}`
  );
}

console.log(`Schema contract ${SCHEMA_CONTRACT_VERSION}: OK`);
