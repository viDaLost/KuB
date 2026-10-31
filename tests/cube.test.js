import test from 'node:test';
import assert from 'node:assert/strict';
import Cube from 'cubejs';
import { CubeModel, FACES, inverse, parseMove, scramble, simplify, tokens } from '../src/cube.js';
import { COURSES } from '../src/lessons.js';

test('all six face conventions match the independent cube.js model', () => {
  const moves = FACES.flatMap(f => [f, `${f}'`, `${f}2`]);
  for (const first of moves) for (const second of moves) {
    const algorithm = `${first} ${second} R U R' U' F2 D L B'`;
    assert.equal(new CubeModel(3).move(algorithm).asString(), new Cube().move(algorithm).asString(), algorithm);
  }
});

for (const size of [2, 3, 4, 5]) {
  test(`${size}×${size}: every layer obeys four-turn identity and inverse`, () => {
    const cube = new CubeModel(size), identity = cube.asString();
    for (const face of FACES) for (let layer = 1; layer <= size; layer++) {
      const move = (layer > 1 ? layer : '') + face;
      assert.equal(new CubeModel(size).move([move, move, move, move]).asString(), identity, move);
      assert.equal(new CubeModel(size).move([move, inverse([move])[0]]).asString(), identity, move);
    }
    if (size > 2) for (const face of FACES) {
      assert.equal(new CubeModel(size).move([`${face}w`, `${face}w`, `${face}w`, `${face}w`]).asString(), identity);
      assert.equal(new CubeModel(size).move(`${face}w`).asString(), new CubeModel(size).move(`${face} 2${face}`).asString());
    }
  });

  test(`${size}×${size}: long scrambles preserve all stickers and can be solved by history`, () => {
    for (let i = 0; i < 20; i++) {
      const moves = scramble(size, 90), cube = new CubeModel(size).move(moves);
      const facelets = cube.asString();
      assert.equal(facelets.length, 6 * size * size);
      for (const face of FACES) assert.equal([...facelets].filter(c => c === face).length, size * size);
      assert.equal(new Set(cube.cubies.map(c => c.pos.join(','))).size, cube.cubies.length);
      cube.move(simplify(inverse(moves)));
      assert.equal(cube.isSolved(), true);
      assert.equal(cube.asString(), new CubeModel(size).asString());
    }
  });

  test(`${size}×${size}: all lessons finish solved from their prepared setup`, () => {
    for (const lesson of COURSES[size].lessons) {
      const cube = new CubeModel(size).move(inverse(lesson.algorithm));
      assert.equal(cube.isSolved(), false, lesson.id);
      cube.move(lesson.algorithm);
      assert.equal(cube.isSolved(), true, lesson.id);
    }
  });
}

test('last-layer exercises preserve the bottom face and first two layers', () => {
  for (const id of ['3-yellow-cross', '3-yellow', '3-corners-last', '3-edges-last']) {
    const lesson = COURSES[3].lessons.find(l => l.id === id);
    const cube = new CubeModel(3).move(inverse(lesson.algorithm));
    assert.ok(cube.facelets('D').every(c => c === 'D'), id);
    for (const face of ['F', 'R', 'L', 'B']) assert.ok(cube.facelets(face).slice(3).every(c => c === face), `${id}: ${face}`);
  }
});

test('3×3 solver resolves scrambled states and normalized middle-slice states', () => {
  Cube.initSolver();
  for (const algorithm of ["R U2 F' D L2 B U R2", "2R U 2F' L B2 2U R D'"]) {
    const cube = new CubeModel(3).move(algorithm);
    const centers = Object.fromEntries(FACES.map(f => [cube.facelets(f)[4], f]));
    const normalized = [...cube.asString()].map(color => centers[color]).join('');
    const solution = Cube.fromString(normalized).solve();
    assert.equal(cube.move(solution).isSolved(), true, algorithm);
  }
});

test('notation validates complete algorithms before applying any mutation', () => {
  assert.deepEqual(tokens(' R U’ F′ '), ['R', "U'", "F'"]);
  assert.deepEqual(inverse("R U R' U'"), ['U', 'R', "U'", "R'"]);
  assert.deepEqual(simplify("R R R' U U U2 F' F"), ['R']);
  assert.equal(parseMove('Rw', 4).layers.length, 2);
  assert.deepEqual(parseMove('2R', 4).layers, [1]);
  assert.equal(parseMove('R2', 4).quarter, -2);
  for (const invalid of ['0R', '6R', 'x', 'R3', '2', 'Rww', 'R\nF']) assert.throws(() => parseMove(invalid, 5));
  assert.throws(() => parseMove('Rw', 2));
  const cube = new CubeModel(3);
  assert.throws(() => cube.move('R U invalid'));
  assert.equal(cube.isSolved(), true);
});
