/* cube.js 1.3.2 uses a classic browser global; keep it outside the ESM bundle.
 * Source: https://github.com/ldez/cubejs — MIT, see vendor/LICENSE.cubejs.txt.
 */
importScripts('./vendor/cube.js', './vendor/solve.js');

let ready = false;
self.onmessage = ({ data }) => {
  try {
    if (!ready) { Cube.initSolver(); ready = true; }
    const cube = Cube.fromString(data.facelets);
    self.postMessage({ id: data.id, solution: cube.isSolved() ? '' : cube.solve() });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
