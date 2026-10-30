// Bundle the repository-pinned official browser SDK; no CDN runtime dependency.
const result = await Bun.build({
  entrypoints: [new URL('./activity-live-source.mjs', import.meta.url).pathname],
  outdir: new URL('../../apps/forum/public/broadcast', import.meta.url).pathname,
  naming: 'activity-live.js', target: 'browser', format: 'iife', minify: true,
  sourcemap: 'none', define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) throw Error('Activity browser bundle failed');
console.log('Built official read-only activity subscription', result.outputs[0].size, 'bytes');
