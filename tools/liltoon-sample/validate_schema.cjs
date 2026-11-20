// Validates the MOCHIYA_materials_liltoon object of one material, or of every material, against the schema with ajv.
// Usage: node validate_schema.cjs <schema.json> <file.vrm> [<material index> | all] [<path to an ajv module>]
const fs = require('fs');

const [schemaPath, glbPath, which, ajvPath] = process.argv.slice(2);
const Ajv = require(ajvPath || 'ajv');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

const buf = fs.readFileSync(glbPath);
const chunkLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + chunkLen).toString('utf8'));

let failures = 0;
json.materials.forEach((m, i) => {
  if (which !== 'all' && i !== Number(which || 0)) return;
  const ext = m.extensions && m.extensions.MOCHIYA_materials_liltoon;
  const ok = validate(ext);
  console.log(`[${i}] ${m.name}: ${ok ? 'valid' : 'INVALID ' + JSON.stringify(validate.errors)}`);
  if (!ok) failures++;
});
console.log('schema failures:', failures);
process.exit(failures ? 1 : 0);
