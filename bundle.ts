import * as esbuild from "https://deno.land/x/esbuild@v0.25.4/mod.js";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";

const file = Deno.readTextFileSync("main.ts");
let write = "";
let start = false;
for (const line of file.split("\n")) {
  if (!line.startsWith("import") && !start) {
    write += "(async () => {\n";
    start = true;
  }
  write += `${line}\n`;
}
if (start)
write += "\n})().catch(err => { console.error(err); process.exit(1); });";
Deno.writeTextFileSync("dist/build.ts", write);

try {
  await esbuild.initialize();

  await esbuild.build({
    entryPoints: ["dist/build.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    plugins: [
      ...denoPlugins({
        loader: "native",
      }),
    ],
    outfile: "dist/out.js",
  });

  esbuild.stop();
} finally {
  Deno.removeSync("dist/build.ts");
}
