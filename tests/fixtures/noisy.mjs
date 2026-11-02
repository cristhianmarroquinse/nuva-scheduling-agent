// Test fixture loaded with `--import`: makes the kind of noise a dependency or a bug would make at runtime.
// The agent must keep all of it off stderr (AC-6.5, OUT-1) and in the traces instead.
// A timer rather than setImmediate: on Node 22 a setImmediate scheduled from a `--import` preload never fires
// once the ESM entry point takes over (it does on Node 24); a timer fires on both.
setTimeout(() => {
  process.emitWarning('fixture deprecation', 'DeprecationWarning');
  process.stderr.write('fixture stray stderr write\n');
  throw new Error('fixture boom');
}, 0);
