// The esm-potrace-wasm dist bundle statically references `fs` and `path` for
// its (unreachable) Node branch. In the Figma UI iframe those modules don't
// exist. Stub them out to empty modules so esbuild stops complaining.
const emptyStubPlugin = {
  name: 'empty-node-builtin-stub',
  setup(build) {
    build.onResolve({ filter: /^(fs|path)$/ }, (args) => ({
      path: args.path,
      namespace: 'empty-stub'
    }))
    build.onLoad({ filter: /.*/, namespace: 'empty-stub' }, () => ({
      contents: 'module.exports = {}; export default {};',
      loader: 'js'
    }))
  }
}

module.exports = function (esbuildConfig) {
  return {
    ...esbuildConfig,
    plugins: [...(esbuildConfig.plugins ?? []), emptyStubPlugin]
  }
}
