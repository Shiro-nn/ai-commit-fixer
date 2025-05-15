import * as esbuild from "https://deno.land/x/esbuild@v0.25.4/mod.js";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";

/**
 * Marks all `node:*` and bare core modules as external
 * so Node's built‑in ESM loader handles them at runtime.
 */
const externalCoreModulesPlugin = {
  name: "external-core-modules",
  setup(build: esbuild.PluginBuild) {
    // List of Node’s built‑in module names you want to externalize
    const builtins = [
      "assert", "buffer", "child_process", "crypto", "dns", "events",
      "fs", "http", "https", "os", "path", "stream", "util", /* …etc… */
    ];
    // Build a regex that matches either `node:foo` or `foo`
    const filter = new RegExp(
        `^(?:node:(?:${builtins.join("|")})|(?:${builtins.join("|")}))$`
    );

    build.onResolve({ filter }, (args: { path: string }) => ({
      path: args.path,
      external: true,
    }));
  },
};

await esbuild.initialize();

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [
    externalCoreModulesPlugin,
    ...denoPlugins({
      loader: "native",
    }),
  ],
  external: ["encoding", "os"],
  outfile: "dist/out.js",
});

esbuild.stop();
