export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
export const COLORS = { U: '#f2d45d', R: '#f25b45', F: '#69bfa0', D: '#f7f5e9', L: '#efa04e', B: '#7199e5' };
export const NORMALS = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
const AXES = { R: 0, L: 0, U: 1, D: 1, F: 2, B: 2 };
const SIGNS = { R: 1, L: -1, U: 1, D: -1, F: 1, B: -1 };

export function tokens(algorithm) {
  if (Array.isArray(algorithm)) return [...algorithm];
  return String(algorithm || '').replace(/[’′]/g, "'").trim().split(/\s+/).filter(Boolean);
}

export function parseMove(token, size = 3) {
  const match = /^(?:(\d+)?([URFDLB])(w)?)(2|')?$/.exec(token);
  if (!match) throw new Error(`Неизвестный ход: ${token}`);
  const [, depth, face, wide, suffix] = match;
  const count = depth ? Number(depth) : wide ? 2 : 1;
  if (count < 1 || count > size || (wide && count === size)) throw new Error(`Слой ${count} недоступен на кубике ${size}×${size}`);
  const axis = AXES[face];
  const sign = SIGNS[face];
  const turns = suffix === '2' ? 2 : suffix === "'" ? -1 : 1;
  const layers = wide ? Array.from({ length: count }, (_, i) => sign * (size - 1 - 2 * i)) : [sign * (size - 1 - 2 * (count - 1))];
  return { token, face, axis, sign, turns, quarter: -sign * turns, layers };
}

export function inverse(algorithm) {
  return tokens(algorithm).reverse().map(t => t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`);
}

export function simplify(algorithm) {
  const result = [];
  for (const token of tokens(algorithm)) {
    const base = token.replace(/[2']$/, '');
    const prev = result.at(-1);
    if (prev && prev.replace(/[2']$/, '') === base) {
      const value = t => t.endsWith('2') ? 2 : t.endsWith("'") ? 3 : 1;
      const sum = (value(prev) + value(token)) % 4;
      result.pop();
      if (sum) result.push(base + (sum === 2 ? '2' : sum === 3 ? "'" : ''));
    } else result.push(token);
  }
  return result;
}

export function rotateVector(vector, axis, quarter) {
  let [x, y, z] = vector;
  const count = ((quarter % 4) + 4) % 4;
  for (let i = 0; i < count; i++) {
    if (axis === 0) [y, z] = [-z, y];
    if (axis === 1) [x, z] = [z, -x];
    if (axis === 2) [x, y] = [-y, x];
  }
  return [x || 0, y || 0, z || 0];
}

export class CubeModel {
  constructor(size = 3) {
    if (![2, 3, 4, 5].includes(size)) throw new Error('Поддерживаются размеры от 2 до 5');
    this.size = size;
    this.reset();
  }

  reset() {
    this.cubies = [];
    const end = this.size - 1;
    let id = 0;
    for (let x = 0; x < this.size; x++) for (let y = 0; y < this.size; y++) for (let z = 0; z < this.size; z++) {
      if (![x, y, z].some(v => v === 0 || v === end)) continue;
      const pos = [2 * x - end, 2 * y - end, 2 * z - end];
      const stickers = FACES.filter(f => pos[AXES[f]] === SIGNS[f] * end).map(color => ({ color, normal: [...NORMALS[color]] }));
      this.cubies.push({ id: id++, pos, stickers });
    }
    return this;
  }

  move(algorithm) {
    const moves = tokens(algorithm).map(t => parseMove(t, this.size));
    for (const move of moves) for (const cubie of this.cubies) {
      if (!move.layers.includes(cubie.pos[move.axis])) continue;
      cubie.pos = rotateVector(cubie.pos, move.axis, move.quarter);
      for (const sticker of cubie.stickers) sticker.normal = rotateVector(sticker.normal, move.axis, move.quarter);
    }
    return this;
  }

  facelets(face) {
    const axis = AXES[face];
    const sign = SIGNS[face];
    const cells = Array(this.size * this.size);
    for (const cubie of this.cubies) for (const sticker of cubie.stickers) {
      if (sticker.normal[axis] !== sign) continue;
      const [x, y, z] = cubie.pos.map(v => (v + this.size - 1) / 2);
      let row, col;
      if (face === 'U') [row, col] = [z, x];
      if (face === 'D') [row, col] = [this.size - 1 - z, x];
      if (face === 'F') [row, col] = [this.size - 1 - y, x];
      if (face === 'B') [row, col] = [this.size - 1 - y, this.size - 1 - x];
      if (face === 'R') [row, col] = [this.size - 1 - y, this.size - 1 - z];
      if (face === 'L') [row, col] = [this.size - 1 - y, z];
      cells[row * this.size + col] = sticker.color;
    }
    return cells;
  }

  asString() { return FACES.map(f => this.facelets(f).join('')).join(''); }
  isSolved() { return FACES.every(f => new Set(this.facelets(f)).size === 1); }
  correctCount() { return FACES.reduce((sum, f) => sum + this.facelets(f).filter(c => c === f).length, 0); }
}

export function scramble(size, count = size === 2 ? 11 : size === 3 ? 20 : 30) {
  const result = [];
  let lastAxis = -1;
  for (let i = 0; i < count; i++) {
    let face;
    do { face = FACES[Math.floor(Math.random() * FACES.length)]; } while (AXES[face] === lastAxis);
    lastAxis = AXES[face];
    const wide = size > 3 && Math.random() < 0.35 ? 'w' : '';
    result.push(face + wide + ['', "'", '2'][Math.floor(Math.random() * 3)]);
  }
  return result;
}
