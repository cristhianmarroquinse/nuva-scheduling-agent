// Test fixture loaded with `--import`: makes the kind of noise a dependency or a bug would make at runtime.
// The agent must keep all of it off stderr (AC-6.5, OUT-1) and in the traces instead.
setImmediate(() => {
  process.emitWarning('fixture deprecation', 'DeprecationWarning');
  process.stderr.write('fixture stray stderr write\n');
  throw new Error('fixture boom');
});
