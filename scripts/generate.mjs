// Regenerates src/schema.d.ts (types only) from the published OpenAPI description.
// SPEC=<path or URL> overrides the source, e.g. SPEC=../StampShow/frontend/pages/developers/api/openapi.yaml
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const spec = process.env.SPEC ?? "https://stamp.show/developers/api/openapi.yaml"
const out = path.join(root, "src", "schema.d.ts")
const bin = path.join(root, "node_modules", "openapi-typescript", "bin", "cli.js")

// --default-non-nullable=false: a property with a default (default_sheet_size) is optional in a request.
execFileSync(process.execPath, [bin, spec, "-o", out, "--default-non-nullable=false"], { stdio: "inherit" })
console.log(`Wrote ${path.relative(root, out)} from ${spec}`)
