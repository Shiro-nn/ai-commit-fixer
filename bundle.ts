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
 * Replace any dynamic require of "node:*" (or "*")
 * with a static ESM import from "node:*".
 */
function getReplaceNodePlugin(moduleName: string) {
  const filter = new RegExp(`^(?:node:)?${moduleName}$`);
  return {
    name: `replace-node-${moduleName}`,
    setup(build: esbuild.PluginBuild) {
      // Intercept both "node:*" and "*"
      build.onResolve(
          { filter },
          (args: esbuild.OnResolveArgs) => ({
            path: args.path,
            namespace: `replace-node-${moduleName}`,
          }),
      );
      // Load a virtual module that does a static import
      build.onLoad(
          { filter: /.*/, namespace: `replace-node-${moduleName}` },
          (loadArgs: esbuild.OnLoadArgs) => ({
            contents: `
        import ${moduleName} from "${loadArgs.path}";
        export default ${moduleName};
        export * from "${loadArgs.path}";
      `,
            loader: "js",
          }),
      );
    },
  }
}

await esbuild.initialize();

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  plugins: [
    replaceNodeFetchPlugin,
    getReplaceNodePlugin("assert"),
    getReplaceNodePlugin("net"),
    getReplaceNodePlugin("http"),
    getReplaceNodePlugin("stream"),
    ...denoPlugins({
      loader: "native",
    }),
  ],
  external: ["encoding"],
  outfile: "dist/out.js",
});

esbuild.stop();
