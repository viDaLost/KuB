import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { COLORS, FACES, NORMALS, parseMove } from './cube.js';

const Z = new THREE.Vector3(0, 0, 1);

function stickerShape() {
  const s = new THREE.Shape();
  const h = 0.412, r = 0.065;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ShapeGeometry(s, 6);
}

export class CubeView {
  constructor(container, model, onSwipe) {
    this.container = container;
    this.model = model;
    this.onSwipe = onSwipe;
    this.meshes = new Map();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    this.camera.position.set(6.6, 5.2, 7.8);
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setClearColor(0, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.55;
    } catch {
      // Keep the simulator usable when the device/browser disables WebGL.
      // Both renderers use the same real 3D scene, model, camera and turn animation.
      this.cssMode = true;
      this.renderer = new CSS3DRenderer();
      this.renderer.domElement.classList.add('css-cube-renderer');
    }
    this.renderer.domElement.setAttribute('aria-label', '3D-кубик. Свайп по кубику поворачивает слой. Нажатие на грань поворачивает её на 90 градусов. Перетаскивание вне кубика вращает весь кубик.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.append(this.renderer.domElement);
    this.inputElement = container.parentElement;
    this.renderer.domElement.style.cursor = 'inherit';
    this.controls = new OrbitControls(this.camera, this.inputElement);
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 24;
    this.controls.rotateSpeed = 0.65;
    this.controls.target.set(0, 0.05, 0);
    this.controls.addEventListener('change', () => this.requestRender());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa6a8c2, 2.6));
    const key = new THREE.DirectionalLight(0xfff8ea, 3.2);
    key.position.set(4, 8, 6); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd6dfff, 2.0);
    fill.position.set(-5, 1, -3); this.scene.add(fill);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.bodyGeometry = new RoundedBoxGeometry(0.96, 0.96, 0.96, 3, 0.052);
    this.stickerGeometry = stickerShape();
    this.bodyMaterial = new THREE.MeshStandardMaterial({ color: '#262932', roughness: 0.5, metalness: 0.05 });
    this.materials = Object.fromEntries(Object.entries(COLORS).map(([face, color]) => [face, new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.02 })]));
    this.labelTextures = new Map();
    this.labelMaterials = new Map();
    this.labels = false;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.frameId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this.inputElement.addEventListener('pointerdown', e => this.pointerDown(e), { capture: true });
    this.inputElement.addEventListener('pointermove', e => this.pointerMove(e), { capture: true });
    this.inputElement.addEventListener('pointerup', e => this.pointerUp(e));
    this.inputElement.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this.cancelDrag(); });
    this.inputElement.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('blur', () => { this.pointers.clear(); this.cancelDrag(); });
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      container.dispatchEvent(new CustomEvent('context-lost'));
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.requestRender());
    this.rebuild(model);
    this.resize();
  }

  labelMaterial(face) {
    if (this.labelMaterials.has(face)) return this.labelMaterials.get(face);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = COLORS[face]; ctx.fillRect(0, 0, 128, 128);
    ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#242932'; ctx.fillText(face, 64, 68);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45 });
    this.labelTextures.set(face, texture); this.labelMaterials.set(face, material);
    return material;
  }

  rebuild(model = this.model) {
    this.model = model;
    // CSS3DObject receives no removed event when only its ancestor Group is
    // detached. Remove its DOM explicitly before replacing the cubie groups.
    if (this.cssMode) this.root.traverse(object => {
      if (object.isCSS3DObject) object.element.remove();
    });
    this.root.clear();
    this.meshes.clear();
    this.root.scale.setScalar(3.1 / model.size);
    for (const cubie of model.cubies) {
      const group = new THREE.Group();
      group.position.set(...cubie.pos.map(v => v / 2));
      const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
      body.userData.cubieId = cubie.id;
      group.add(body);
      if (this.cssMode) for (const face of FACES) {
        const normal = NORMALS[face];
        const sticker = cubie.stickers.find(s => s.normal.every((v, i) => v === normal[i]));
        const element = document.createElement('div');
        element.className = 'css-cube-face';
        if (sticker) {
          const tile = document.createElement('div');
          tile.style.backgroundColor = COLORS[sticker.color];
          if (this.labels) tile.textContent = sticker.color;
          element.append(tile);
        }
        element.style.filter = face === 'U' ? 'brightness(1.04)' : face === 'R' ? 'brightness(.87)' : face === 'B' ? 'brightness(.83)' : face === 'D' ? 'brightness(.8)' : 'none';
        const object = new CSS3DObject(element);
        object.scale.setScalar(0.01);
        object.position.set(...normal.map(v => v * 0.48));
        object.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...normal));
        group.add(object);
      }
      for (const sticker of cubie.stickers) {
        const mesh = new THREE.Mesh(this.stickerGeometry, this.labels ? this.labelMaterial(sticker.color) : this.materials[sticker.color]);
        mesh.position.set(...sticker.normal.map(v => v * 0.485));
        mesh.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...sticker.normal));
        mesh.userData.sticker = true;
        mesh.userData.cubieId = cubie.id;
        group.add(mesh);
      }
      this.meshes.set(cubie.id, group);
      this.root.add(group);
    }
    this.requestRender();
  }

  setLabels(value) { this.labels = value; this.rebuild(); }

  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const distance = Math.max(8.8, 8.5 / this.camera.aspect);
    const zoomRatio = this.fitDistance ? this.camera.position.distanceTo(this.controls.target) / this.fitDistance : 1;
    this.fitDistance = distance;
    this.camera.position.sub(this.controls.target).normalize().multiplyScalar(distance * zoomRatio).add(this.controls.target);
    this.controls.update();
    this.renderer.setSize(width, height);
    this.requestRender();
  }

  requestRender() {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  home() {
    this.controls.target.set(0, 0.05, 0);
    this.camera.position.set(6.6, 5.2, 7.8).normalize().multiplyScalar(this.fitDistance || 8.8).add(this.controls.target);
    this.controls.update(); this.requestRender();
  }
  zoom(direction) { this.camera.position.multiplyScalar(direction > 0 ? 0.9 : 1.1); this.controls.update(); this.requestRender(); }

  async turn(token, duration = 300) {
    const move = parseMove(token, this.model.size);
    this.animating = true;
    const pivot = new THREE.Group(); this.root.add(pivot);
    const selected = this.model.cubies.filter(c => move.layers.includes(c.pos[move.axis])).map(c => this.meshes.get(c.id));
    for (const mesh of selected) pivot.attach(mesh);
    const target = move.quarter * Math.PI / 2;
    const axis = ['x', 'y', 'z'][move.axis];
    if (duration > 0) await new Promise(resolve => {
      const start = performance.now();
      const animate = now => {
        const t = Math.min(1, (now - start) / duration);
        const ease = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
        pivot.rotation[axis] = target * ease;
        this.requestRender();
        if (t < 1) requestAnimationFrame(animate); else resolve();
      };
      requestAnimationFrame(animate);
    });
    pivot.rotation[axis] = target;
    pivot.updateMatrixWorld(true);
    for (const mesh of selected) {
      this.root.attach(mesh);
      mesh.position.set(...mesh.position.toArray().map(v => Math.round(v * 2) / 2));
      const matrix = new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion);
      matrix.elements = matrix.elements.map((v, i) => i === 15 ? 1 : Math.round(v));
      mesh.quaternion.setFromRotationMatrix(matrix);
    }
    this.root.remove(pivot);
    this.model.move(token);
    this.animating = false;
    this.requestRender();
  }

  hitAt(x, y) {
    this.scene.updateMatrixWorld(true);
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), this.camera);
    return this.raycaster.intersectObject(this.root, true).find(h => h.object.userData.cubieId !== undefined);
  }

  pointerDown(event) {
    if (event.target.closest('button, select, input, summary, .move-panel')) { event.stopPropagation(); return; }
    if (![0, 2].includes(event.button)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size > 1) {
      this.drag = null;
      this.controls.enabled = false;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), cameraDistance: this.camera.position.distanceTo(this.controls.target) };
      this.inputElement.setPointerCapture(event.pointerId);
      return;
    }
    const hit = this.hitAt(event.clientX, event.clientY);
    if (!hit) return;
    // Capture on the cube before OrbitControls sees pointerdown. The camera
    // therefore never starts an orbit for the same swipe that turns a layer.
    this.controls.enabled = false;
    this.inputElement.setPointerCapture(event.pointerId);
    if (this.animating) return;
    const normal = hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    const axis = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)));
    const sign = Math.sign(normal.getComponent(axis));
    normal.set(0, 0, 0).setComponent(axis, sign);
    this.drag = { x: event.clientX, y: event.clientY, id: event.pointerId, cubieId: hit.object.userData.cubieId, normal, point: hit.point, button: event.button, started: performance.now() };
    this.inputElement.style.cursor = 'grabbing';
  }

  pointerMove(event) {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.drag?.id === event.pointerId) this.drag.moved = Math.max(this.drag.moved || 0, Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y));
    if (this.pinch && this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      const length = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const distance = THREE.MathUtils.clamp(this.pinch.cameraDistance * this.pinch.distance / length, this.controls.minDistance, this.controls.maxDistance);
      this.camera.position.sub(this.controls.target).normalize().multiplyScalar(distance).add(this.controls.target);
      this.controls.update(); this.requestRender();
    } else if (!this.pointers.size && event.pointerType === 'mouse') {
      this.inputElement.style.cursor = this.hitAt(event.clientX, event.clientY) ? 'pointer' : 'grab';
    }
  }

  pointerUp(event) {
    this.pointers.delete(event.pointerId);
    if (this.pinch) { if (!this.pointers.size) this.cancelDrag(); return; }
    if (!this.drag || event.pointerId !== this.drag.id) { if (!this.pointers.size) this.cancelDrag(); return; }
    const drag = this.drag;
    this.cancelDrag();
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (this.animating || !this.onSwipe) return;
    if (Math.hypot(dx, dy) < 10) {
      if (drag.moved >= 10) return;
      const axis = drag.normal.toArray().findIndex(v => v !== 0);
      const sign = drag.normal.getComponent(axis);
      const face = axis === 0 ? sign > 0 ? 'R' : 'L' : axis === 1 ? sign > 0 ? 'U' : 'D' : sign > 0 ? 'F' : 'B';
      const reverse = event.shiftKey || drag.button === 2 || performance.now() - drag.started > 450;
      this.onSwipe(face + (reverse ? "'" : ''), { kind: 'tap', reverse });
      return;
    }
    const cubie = this.model.cubies.find(c => c.id === drag.cubieId);
    const dimensions = ['x', 'y', 'z'];
    const rect = this.renderer.domElement.getBoundingClientRect();
    const origin = drag.point.clone().project(this.camera);
    let best = null;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(drag.normal.getComponent(axis)) > 0.5) continue;
      const vector = new THREE.Vector3(); vector.setComponent(axis, 1);
      const tangent = vector.cross(drag.normal);
      const point = drag.point.clone().add(tangent.multiplyScalar(0.5)).project(this.camera);
      const sx = (point.x - origin.x) * rect.width, sy = -(point.y - origin.y) * rect.height;
      const dot = (sx * dx + sy * dy) / Math.hypot(sx, sy);
      if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { axis, dot };
    }
    if (!best) return;
    const pos = cubie.pos[best.axis];
    const sign = pos >= 0 ? 1 : -1;
    const depth = (this.model.size - 1 - Math.abs(pos)) / 2 + 1;
    const face = dimensions[best.axis] === 'x' ? sign > 0 ? 'R' : 'L' : dimensions[best.axis] === 'y' ? sign > 0 ? 'U' : 'D' : sign > 0 ? 'F' : 'B';
    const quarter = best.dot > 0 ? 1 : -1;
    this.onSwipe((depth > 1 ? depth : '') + face + (quarter === -sign ? '' : "'"), { kind: 'swipe' });
  }

  cancelDrag() { this.drag = null; this.pinch = null; this.controls.enabled = true; this.inputElement.style.cursor = 'grab'; }
}
