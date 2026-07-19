import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const schemasRoot = path.join(packageRoot, "schemas");
const fixturesRoot = path.join(packageRoot, "conformance", "fixtures");
const registryPath = path.join(schemasRoot, "index.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listJsonFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith(".json") ? [absolutePath] : [];
  });
}

const registry = readJson(registryPath);
const schemaEntries = registry.schemas ?? [];
const schemaByName = new Map(schemaEntries.map((entry) => [entry.name, entry]));
const fixtureCoverage = new Map(
  schemaEntries.map((entry) => [entry.name, { invalid: 0, valid: 0 }]),
);

if (schemaEntries.length === 0) {
  throw new Error("schemas/index.json must list at least one schema.");
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

for (const entry of schemaEntries) {
  const schemaPath = path.join(schemasRoot, entry.path);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Registry entry ${entry.name} points to missing schema ${entry.path}.`);
  }

  const schema = readJson(schemaPath);
  if (schema.$id !== entry.id) {
    throw new Error(`Registry id mismatch for ${entry.name}: ${schema.$id} !== ${entry.id}.`);
  }

  ajv.addSchema(schema, entry.id);
}

for (const entry of schemaEntries) {
  if (!ajv.getSchema(entry.id)) {
    throw new Error(`Schema did not compile: ${entry.name}.`);
  }
}

let fixtureCount = 0;
for (const expectation of ["valid", "invalid"]) {
  const expectationRoot = path.join(fixturesRoot, expectation);
  for (const fixturePath of listJsonFiles(expectationRoot)) {
    fixtureCount += 1;
    const relativeFixturePath = path.relative(expectationRoot, fixturePath);
    const schemaName = relativeFixturePath.split(path.sep)[0];
    const entry = schemaByName.get(schemaName);

    if (!entry) {
      throw new Error(`Fixture ${relativeFixturePath} has no schema registry entry.`);
    }

    fixtureCoverage.get(schemaName)[expectation] += 1;

    const validate = ajv.getSchema(entry.id);
    const fixture = readJson(fixturePath);
    const isValid = validate(fixture);

    if (expectation === "valid" && !isValid) {
      throw new Error(`Expected valid fixture failed ${relativeFixturePath}: ${ajv.errorsText(validate.errors)}`);
    }

    if (expectation === "invalid" && isValid) {
      throw new Error(`Expected invalid fixture passed ${relativeFixturePath}.`);
    }
  }
}

if (fixtureCount === 0) {
  throw new Error("No conformance fixtures found.");
}

for (const entry of schemaEntries) {
  const coverage = fixtureCoverage.get(entry.name);
  if (!coverage || coverage.valid === 0 || coverage.invalid === 0) {
    throw new Error(
      `Schema ${entry.name} must have at least one valid and one invalid fixture.`,
    );
  }
}

console.log(`Validated ${schemaEntries.length} schemas and ${fixtureCount} fixtures.`);
