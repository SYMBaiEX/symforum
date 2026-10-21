import { expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

test('pins the SDK-compatible singleton config and only the worker Docker context', async () => {
  const root = resolve(import.meta.dir, '..');
  const config = JSON.parse(await Bun.file(resolve(root, 'wrangler.jsonc')).text());
  const manifest = JSON.parse(await Bun.file(resolve(root, 'package.json')).text());
  expect(manifest.dependencies['@cloudflare/containers']).toBe('0.3.7');
  expect(manifest.devDependencies.wrangler).toBe('4.151.3');
  expect(config.compatibility_date).toBe('2026-10-20');
  expect(config.containers).toHaveLength(1);
  expect(config.containers[0]).toEqual({
    class_name: 'ElizaShadowContainer',
    scheduling_policy: 'default',
    image: '../eliza-shadow/Dockerfile',
    image_build_context: '../eliza-shadow',
    instance_type: 'basic',
    max_instances: 1,
    observability: { enabled: false },
  });
  expect(realpathSync(resolve(root, config.containers[0].image_build_context))).toBe(realpathSync(resolve(root, '../eliza-shadow')));
  expect(realpathSync(resolve(root, config.containers[0].image))).toBe(realpathSync(resolve(root, '../eliza-shadow/Dockerfile')));
  expect(config.exports).toEqual({ ElizaShadowContainer: { type: 'durable-object', storage: 'sqlite' } });
  expect(config.migrations).toBeUndefined();
  expect(config.vars).toBeUndefined();
  expect(config.routes).toBeUndefined();
});
