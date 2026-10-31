import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CubeModel } from '../src/cube.js';

test('the actual browser worker loads its classic vendor scripts and solves messages', () => {
  const publicRoot = new URL('../public/', import.meta.url);
  const messages = [];
  const context = vm.createContext({ postMessage: data => messages.push(data) });
  context.self = context;
  context.importScripts = (...paths) => {
    for (const path of paths) {
      const url = new URL(path, publicRoot);
      vm.runInContext(readFileSync(url, 'utf8'), context, { filename: fileURLToPath(url) });
    }
  };
  vm.runInContext(readFileSync(new URL('solver.worker.js', publicRoot), 'utf8'), context);
  const cube = new CubeModel(3).move("R U2 F' D B2 L U");
  context.onmessage({ data: { id: 'integration', facelets: cube.asString() } });
  assert.equal(messages[0].id, 'integration');
  assert.equal(messages[0].error, undefined);
  assert.equal(cube.move(messages[0].solution).isSolved(), true);
  context.onmessage({ data: { id: 'solved', facelets: new CubeModel(3).asString() } });
  assert.equal(messages[1].solution, '');
});
