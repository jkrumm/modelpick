import { client } from "../src/db/index.js";
import { writeStackFile } from "../src/server/stack-file.js";

console.log(`[stack] ${await writeStackFile()}`);
await client.end();
