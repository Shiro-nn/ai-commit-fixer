import * as esbuild from "https://deno.land/x/esbuild@v0.25.4/mod.js";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.1";

/**
 * An esbuild plugin to redirect any "node-fetch" import
 * to Undici's ESM `fetch`.
 */
const replaceNodeFetchPlugin = {
  name: "replace-node-fetch",
  setup(build: esbuild.PluginBuild) {
    // 1) Catch all import requests for "node-fetch"
    build.onResolve(
      { filter: /^node-fetch$/ },
      (args: esbuild.OnResolveArgs) => ({
        path: args.path,
        namespace: "replace-node-fetch",
      }),
    );

    // 2) Provide a virtual module that re-exports Undici fetch
    build.onLoad({ filter: /.*/, namespace: "replace-node-fetch" }, () => ({
      contents: `
        import { fetch } from "npm:undici";
        export default fetch;
        export * from "npm:undici";
      `,
      loader: "js",
    }));
  },
};

/**
 * Replace any dynamic require of "node:assert" (or "assert")
 * with a static ESM import from "node:assert".
 */
const replaceNodeAssertPlugin = {
  name: "replace-node-assert",
  setup(build: esbuild.PluginBuild) {
    // Intercept both "node:assert" and "assert"
    build.onResolve(
      { filter: /^(?:node:)?assert$/ },
      (args: esbuild.OnResolveArgs) => ({
        path: args.path,
        namespace: "replace-node-assert",
      }),
    );
    // Load a virtual module that does a static import
    build.onLoad(
      { filter: /.*/, namespace: "replace-node-assert" },
      (loadArgs: esbuild.OnLoadArgs) => ({
        contents: `
        import assert from "${loadArgs.path}";
        export default assert;
        export * from "${loadArgs.path}";
      `,
        loader: "js",
      }),
    );
  },
};

await esbuild.initialize();

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [
    replaceNodeFetchPlugin,
    replaceNodeAssertPlugin,
    ...denoPlugins({
      loader: "native",
    }),
  ],
  external: ["encoding"],
  outfile: "dist/out.js",
});

esbuild.stop();
