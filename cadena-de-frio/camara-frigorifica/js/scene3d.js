// MOTOR VISUAL 3D (Three.js): cámara, puerta, evaporador, racks, pallets, montacargas, mapa térmico,
// flujo de aire con partículas, intercambio por la puerta y sensores. La escena solo LEE el estado del
// simulador: nunca es la fuente de verdad.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heatRGB } from './heat.js';
import { SLOT } from './config.js';

const N_FLOW = 600, N_DOOR = 140;

export function createScene(container, handlers) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 4; controls.maxDistance = 70;
  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x1a2230, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-8, 20, 12); scene.add(sun);

  const labels = document.createElement('div'); labels.className = 'labels3d'; container.appendChild(labels);
  const S = { layers: { heat: true, flow: false, sensors: false, pallets: true }, view: '3d', level: 1, sel: null, tween: null, fanAngle: 0, t: 0 };
  let W3 = null; // objetos de la sala actual
  const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);

  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...extra });

  function disposeGroup(g) {
    g.traverse((o) => { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose()); });
  }

  // ---------- Construcción de la sala ----------
  function build(R, p, sensors) {
    if (W3) { scene.remove(W3.group); disposeGroup(W3.group); labels.innerHTML = ''; }
    const group = new THREE.Group(); scene.add(group);
    const L = p.L, W = p.W, H = p.H, X = (x) => x - L / 2, Z = (y) => y - W / 2;
    const o = { group, R, p, X, Z, walls: {}, pick: [] };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(L + 14, W + 10), std(0x151b23, { roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(-3.5, -0.01, 0); group.add(ground);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(L, W), std(0x222c39, { roughness: 1 }));
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.002; group.add(inner);
    const dock = new THREE.Mesh(new THREE.PlaneGeometry(5, p.doorW + 2), std(0x2a2f36, { roughness: 1 }));
    dock.rotation.x = -Math.PI / 2; dock.position.set(X(-2.5), 0.003, 0); group.add(dock);

    // Paredes translúcidas + aristas (la cámara se ve por dentro).
    const wm = () => new THREE.MeshStandardMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    const plane = (w, h, pos, rotY = 0, rotX = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wm()); m.position.copy(pos); m.rotation.set(rotX, rotY, 0); group.add(m); return m; };
    o.walls.back = [plane(W, H, new THREE.Vector3(X(L), H / 2, 0), Math.PI / 2)];
    o.walls.left = [plane(L, H, new THREE.Vector3(0, H / 2, Z(0)))];
    o.walls.right = [plane(L, H, new THREE.Vector3(0, H / 2, Z(W)))];
    o.walls.ceiling = [plane(L, W, new THREE.Vector3(0, H, 0), 0, Math.PI / 2)];
    const dw = p.doorW, dh = Math.min(p.doorH, H - 0.3), side = (W - dw) / 2;
    o.walls.front = [
      plane(side, H, new THREE.Vector3(X(0), H / 2, -dw / 2 - side / 2), Math.PI / 2),
      plane(side, H, new THREE.Vector3(X(0), H / 2, dw / 2 + side / 2), Math.PI / 2),
      plane(dw, H - dh, new THREE.Vector3(X(0), dh + (H - dh) / 2, 0), Math.PI / 2),
    ];
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)), new THREE.LineBasicMaterial({ color: 0x5b6b80 }));
    edges.position.y = H / 2; group.add(edges); o.edges = edges;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(dw, dh)), new THREE.LineBasicMaterial({ color: 0x8b9bb0 }));
    frame.rotation.y = Math.PI / 2; frame.position.set(X(0) - 0.01, dh / 2, 0); group.add(frame); o.doorFrame = frame;

    // Puerta corrediza
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, dh, dw), std(0x9aa7b8, { metalness: 0.4, roughness: 0.4 }));
    door.position.set(X(0) - 0.08, dh / 2, 0); door.userData.pick = { kind: 'door', id: 0 }; group.add(door); o.door = door; o.dw = dw;
    // Cortina (tiras) si está activa
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), new THREE.MeshStandardMaterial({ color: 0x9fd3ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    curtain.rotation.y = Math.PI / 2; curtain.position.set(X(0) + 0.05, dh / 2, 0); group.add(curtain); o.curtain = curtain;

    // Evaporador con 3 ventiladores
    const evap = new THREE.Group(); evap.position.set(X(L - 0.4), H - 0.75, 0); group.add(evap);
    const ew = Math.min(W * 0.62, 6);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, ew), std(0x6d7f95, { metalness: 0.3, roughness: 0.55 }));
    body.userData.pick = { kind: 'evap', id: 0 }; evap.add(body); o.evapBody = body;
    o.blades = [];
    for (let i = 0; i < 3; i++) {
      const zc = (i - 1) * (ew / 3), ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 24), std(0x2b3440));
      ring.rotation.y = Math.PI / 2; ring.position.set(-0.37, 0, zc); evap.add(ring);
      const bl = new THREE.Group(); bl.position.set(-0.38, 0, zc); evap.add(bl);
      for (let b = 0; b < 4; b++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.09), std(0xc9d3df)); m.rotation.x = (b * Math.PI) / 2; m.userData.pick = { kind: 'evap', id: 0 }; bl.add(m); }
      o.blades.push(bl);
    }
    o.pick.push(body);

    // Racks por columna (para poder ocultarlos en la vista de sección)
    const cols = [];
    const qs = [...new Set(R.slots.map((s) => s.x))].sort((a, b) => a - b), pitch = qs.length > 1 ? qs[1] - qs[0] : SLOT.pitch;
    const rackGeo = new THREE.BoxGeometry(1, 1, 1), rackMat = std(0x5b6b80, { metalness: 0.4 });
    const levelTop = R.dz + 0.15 + SLOT.palletH + 0.1;
    for (let j = 0; j < R.ny; j++) {
      const yc = (j + 0.5) * R.dy, zs = [Z(yc - SLOT.rackDepth / 2), Z(yc + SLOT.rackDepth / 2)];
      const items = [];
      for (let q = 0; q <= qs.length; q++) for (const z of zs) items.push([X(qs[0] - pitch / 2 + q * pitch), levelTop / 2, z, 0.08, levelTop, 0.08]);
      for (const y of [R.dz + 0.08, levelTop]) for (const z of zs) items.push([X((qs[0] + qs[qs.length - 1]) / 2), y, z, qs.length * pitch, 0.1, 0.06]);
      const im = new THREE.InstancedMesh(rackGeo, rackMat, items.length);
      items.forEach((it, i) => { tmpM.compose(tmpV.set(it[0], it[1], it[2]), tmpQ.identity(), new THREE.Vector3(it[3], it[4], it[5])); im.setMatrixAt(i, tmpM); });
      group.add(im); cols.push(im);
    }
    o.racks = cols;

    // Pallets (instancias; color = temperatura de núcleo)
    const pg = new THREE.BoxGeometry(SLOT.palletW, SLOT.palletH, SLOT.palletD); pg.translate(0, SLOT.palletH / 2, 0);
    const pal = new THREE.InstancedMesh(pg, std(0xffffff, { roughness: 0.85 }), R.slots.length + 4);
    pal.instanceMatrix.setUsage(THREE.DynamicDrawUsage); pal.count = 0; pal.frustumCulled = false; group.add(pal); o.pal = pal; o.palIds = [];
    pal.setColorAt(0, tmpC.set(0xffffff));
    const baseG = new THREE.BoxGeometry(SLOT.palletW, 0.14, SLOT.palletD); baseG.translate(0, -0.07, 0);
    const base = new THREE.InstancedMesh(baseG, std(0x7a5a3a), R.slots.length + 4); base.count = 0; base.frustumCulled = false; group.add(base); o.palBase = base;

    // Montacargas
    const fk = new THREE.Group();
    const fb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.0), std(0xd1a21c)); fb.position.y = 0.6; fk.add(fb);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.9), std(0x3a3f47)); mast.position.set(0.7, 1.2, 0); fk.add(mast);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.3 })); cab.position.set(-0.1, 1.55, 0); fk.add(cab);
    fk.visible = false; group.add(fk); o.fork = fk;

    // Mapa térmico: una caja translúcida por zona
    o.heat = [];
    const hg = new THREE.BoxGeometry(R.dx * 0.94, R.dz * 0.94, R.dy * 0.94);
    for (let z = 0; z < R.n; z++) {
      const zn = R.zones[z], m = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false, color: 0x0ca30c }));
      m.position.set(X(zn.x), zn.h, Z(zn.y)); m.userData.pick = { kind: 'zone', id: z }; m.renderOrder = 2; group.add(m); o.heat.push(m);
    }

    // Partículas de flujo de aire (lazo por columna)
    const fp = new Float32Array(N_FLOW * 3), fc = new Float32Array(N_FLOW * 3);
    const fgeo = new THREE.BufferGeometry(); fgeo.setAttribute('position', new THREE.BufferAttribute(fp, 3)); fgeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    const flow = new THREE.Points(fgeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    flow.frustumCulled = false; group.add(flow); o.flow = flow;
    const LA = L - 1.6, LB = H - 1, loopLen = 2 * (LA + LB);
    o.flowP = Array.from({ length: N_FLOW }, (_, i) => ({ j: i % R.ny, s: Math.random() * loopLen, lat: Math.random() * 2 - 1, v: Math.random() }));
    o.loop = { LA, LB, loopLen };

    // Intercambio por la puerta: aire caliente entra arriba, aire frío sale abajo
    const dp = new Float32Array(N_DOOR * 2 * 3), dc = new Float32Array(N_DOOR * 2 * 3);
    const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dp, 3)); dgeo.setAttribute('color', new THREE.BufferAttribute(dc, 3));
    const dpts = new THREE.Points(dgeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    dpts.frustumCulled = false; group.add(dpts); o.doorPts = dpts;
    o.doorP = Array.from({ length: N_DOOR * 2 }, (_, i) => ({ inflow: i < N_DOOR, life: 0, x: 0, y: 0, h: 0 }));

    // Sensores virtuales
    o.sensors = sensors.map((s) => {
      const zn = R.zones[s.zone];
      let x = s.i === 0 ? 0.5 : zn.x, y = zn.y + R.dy * 0.42, h = s.k ? H - 0.9 : 1.4;
      if (s.kind === 'supply') { x = L - 1.0; y = W / 2; h = H - 0.75; }
      if (s.kind === 'return') { x = L - 0.8; y = W / 2; h = 0.6; }
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), std(0xffffff, { emissive: 0x000000 }));
      m.position.set(X(x), h, Z(y)); m.userData.pick = { kind: 'sensor', id: s.id }; group.add(m);
      const el = document.createElement('div'); el.className = 'lbl'; labels.appendChild(el);
      return { id: s.id, mesh: m, el };
    });

    const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xe6edf3); selBox.visible = false; group.add(selBox); o.selBox = selBox;
    W3 = o;
    applyVisibility();
    setView(S.view, true);
  }

  // ---------- Vistas y capas ----------
  function camTarget(view) {
    const { L, W, H } = W3.p;
    if (view === 'planta') return { pos: new THREE.Vector3(0, Math.max(L, W) * 1.9, 0.01), tgt: new THREE.Vector3(0, 0, 0) };
    if (view === 'seccion') return { pos: new THREE.Vector3(0, H * 0.55, W / 2 + L * 1.05), tgt: new THREE.Vector3(0, H * 0.45, 0) };
    return { pos: new THREE.Vector3(-L * 0.95, H * 2.1, W * 1.55), tgt: new THREE.Vector3(L * 0.05, H * 0.3, 0) };
  }
  function setView(v, instant = false) {
    S.view = v;
    if (!W3) return;
    const c = camTarget(v);
    if (instant) { camera.position.copy(c.pos); controls.target.copy(c.tgt); S.tween = null; }
    else S.tween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: c.pos, t1: c.tgt };
    controls.enableRotate = v === '3d';
    applyVisibility();
  }
  function applyVisibility() {
    if (!W3) return;
    const v = S.view, R = W3.R, jd = R.jd, lay = S.layers;
    W3.walls.ceiling.forEach((m) => (m.visible = v === '3d'));
    W3.walls.right.forEach((m) => (m.visible = v !== 'seccion'));
    W3.edges.visible = v !== 'seccion';
    W3.racks.forEach((im, j) => (im.visible = !(v === 'seccion' && j > jd)));
    W3.heat.forEach((m, z) => {
      const zn = R.zones[z];
      m.visible = lay.heat && !(v === 'seccion' && zn.j !== jd) && !(v === 'planta' && zn.k !== S.level);
      m.material.opacity = v === 'seccion' ? 0.5 : v === 'planta' ? 0.42 : 0.2;
    });
    W3.flow.visible = lay.flow;
    W3.sensors.forEach((s) => { s.mesh.visible = lay.sensors; s.el.style.display = lay.sensors ? '' : 'none'; });
  }
  function setLayers(l) { Object.assign(S.layers, l); applyVisibility(); }
  function setLevel(k) { S.level = k; applyVisibility(); }

  // ---------- Interacción: hover y selección ----------
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let mouseIn = false, mx = 0, my = 0, lastPick = 0, hover = null, downAt = null;
  const el = renderer.domElement;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top;
    mouse.set((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1); mouseIn = true;
  });
  el.addEventListener('pointerleave', () => { mouseIn = false; hover = null; handlers.hover?.(null); });
  el.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  el.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const hit = pick();
    S.sel = hit; handlers.select?.(hit);
  });
  function pick() {
    if (!W3) return null;
    ray.setFromCamera(mouse, camera);
    const groups = [
      W3.sensors.filter((s) => s.mesh.visible).map((s) => s.mesh),
      S.layers.pallets ? [W3.pal] : [],
      [W3.evapBody, ...W3.blades.flatMap((b) => b.children), W3.door],
      W3.heat.filter((m) => m.visible),
    ];
    for (const g of groups) {
      if (!g.length) continue;
      const hit = ray.intersectObjects(g, false)[0];
      if (!hit) continue;
      if (hit.object === W3.pal) { const id = W3.palIds[hit.instanceId]; if (id !== undefined) return { kind: 'pallet', id }; continue; }
      return hit.object.userData.pick || null;
    }
    return null;
  }

  // ---------- Actualización por cuadro ----------
  function palletPos(pal, R, p) {
    const s = pal.slot;
    if (pal.state === 'stored' || pal.progress === undefined) return { x: s.x, y: s.y, h: s.h, dir: 0 };
    const jd = R.jd, aisle = s.j < jd ? (s.j + 1) * R.dy : s.j * R.dy;
    const inside = [[0.2, p.W / 2, 0.15], [0.8, aisle, 0.15], [s.x, aisle, 0.15], [s.x, s.y, s.h]];
    const f = pal.progress;
    if (f < 0.3) { const g = f / 0.3; return { x: -4 + g * 4.2, y: p.W / 2, h: 0.15, dir: 0 }; }
    const g = (f - 0.3) / 0.7, seg = [];
    let tot = 0;
    for (let i = 1; i < inside.length; i++) { const d = Math.hypot(inside[i][0] - inside[i - 1][0], inside[i][1] - inside[i - 1][1]) + Math.abs(inside[i][2] - inside[i - 1][2]); seg.push(d); tot += d; }
    let d = g * tot;
    for (let i = 1; i < inside.length; i++) {
      if (d <= seg[i - 1] || i === inside.length - 1) {
        const t = Math.min(1, d / (seg[i - 1] || 1)), a = inside[i - 1], b = inside[i];
        return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: a[2] + (b[2] - a[2]) * t, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      }
      d -= seg[i - 1];
    }
    return { x: s.x, y: s.y, h: s.h, dir: 0 };
  }

  function update(st, p, dtR, playing, speed) {
    if (!W3) return;
    S.t += dtR;
    const R = W3.R, { X, Z } = W3, off = p.alarmOffset, sp = p.sp, simK = playing ? Math.min(4, Math.sqrt(speed)) : 0;
    // Puerta y cortina
    W3.door.position.z = st.door.frac * W3.dw * 0.95;
    W3.doorFrame.material.color.set(st.door.frac > 0.02 ? 0xfab219 : 0x8b9bb0);
    W3.curtain.visible = !!p.curtain;
    // Evaporador: giro de ventiladores, brillo de enfriamiento y escarcha
    S.fanAngle += dtR * st.air.fanFrac * 18 * (playing ? 1 : 0);
    W3.blades.forEach((b, i) => { b.rotation.x = p.evapFail && i === 1 ? 0.3 : S.fanAngle + i; }); // falla: un ventilador detenido
    const fr = Math.min(1, st.evap.frost / 150);
    W3.evapBody.material.color.setRGB(0.43 + 0.5 * fr, 0.5 + 0.44 * fr, 0.58 + 0.4 * fr);
    W3.evapBody.material.emissive.setRGB(0.05 * st.ctrl.u, 0.2 * st.ctrl.u, 0.45 * st.ctrl.u);
    // Mapa térmico
    for (let z = 0; z < R.n; z++) { const c = heatRGB(st.T[z], sp, off); W3.heat[z].material.color.setRGB(c[0], c[1], c[2]); }
    // Pallets
    const pal = W3.pal, base = W3.palBase; let n = 0;
    W3.palIds.length = 0;
    const hideCol = S.view === 'seccion' ? R.jd : 99;
    for (const q of st.pallets) {
      if (!S.layers.pallets) break;
      if (q.slot.j > hideCol && q.state === 'stored') continue;
      if (S.view === 'planta' && q.state === 'stored' && q.slot.k !== S.level) continue;
      const ps = palletPos(q, R, p);
      tmpM.compose(tmpV.set(X(ps.x), ps.h + 0.14, Z(ps.y)), tmpQ.identity(), ONE);
      pal.setMatrixAt(n, tmpM); base.setMatrixAt(n, tmpM);
      const c = heatRGB(q.Tc, sp, off); pal.setColorAt(n, tmpC.setRGB(c[0], c[1], c[2]));
      W3.palIds[n] = q.id; n++;
    }
    pal.count = n; base.count = n; pal.instanceMatrix.needsUpdate = true; base.instanceMatrix.needsUpdate = true;
    if (pal.instanceColor) pal.instanceColor.needsUpdate = true;
    // Montacargas detrás del pallet en tránsito
    if (st.forklift && st.forklift.pal) {
      const ps = palletPos(st.forklift.pal, R, p);
      W3.fork.visible = true;
      W3.fork.position.set(X(ps.x) - Math.cos(ps.dir) * 1.25, 0, Z(ps.y) - Math.sin(ps.dir) * 1.25);
      W3.fork.rotation.y = -ps.dir;
    } else W3.fork.visible = false;
    // Flujo de aire
    if (S.layers.flow) updateFlow(st, p, dtR * simK);
    updateDoorFlow(st, p, dtR * Math.max(simK, playing ? 1 : 0));
    // Sensores
    const rect = el.getBoundingClientRect();
    for (const s of W3.sensors) {
      const sd = st.sensors.find((x) => x.id === s.id), c = heatRGB(sd.T, sp, off);
      s.mesh.material.color.setRGB(c[0], c[1], c[2]); s.mesh.material.emissive.setRGB(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
      if (!S.layers.sensors) continue;
      tmpV.copy(s.mesh.position).project(camera);
      const vis = tmpV.z < 1;
      s.el.style.display = vis ? '' : 'none';
      s.el.style.transform = `translate(${((tmpV.x + 1) / 2) * rect.width + 10}px, ${((1 - tmpV.y) / 2) * rect.height - 10}px)`;
      s.el.textContent = `${sd.id} ${sd.T.toFixed(1)}°`;
      s.el.classList.toggle('on', S.sel?.kind === 'sensor' && S.sel.id === s.id);
    }
    // Selección
    updateSelection(st, p);
    // Hover
    if (mouseIn && performance.now() - lastPick > 60) {
      lastPick = performance.now();
      const h = pick();
      if ((h?.kind !== hover?.kind) || (h?.id !== hover?.id)) hover = h;
      handlers.hover?.(hover, mx, my);
    }
    // Cámara
    if (S.tween) {
      const tw = S.tween; tw.t = Math.min(1, tw.t + dtR / 0.7); const e = 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.t >= 1) S.tween = null;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  function updateFlow(st, p, dts) {
    const o = W3, R = o.R, { LA, LB, loopLen } = o.loop, pos = o.flow.geometry.attributes.position.array, col = o.flow.geometry.attributes.color.array;
    const L = p.L, H = p.H, x0 = 0.6, x1 = L - 1.0;
    for (let i = 0; i < N_FLOW; i++) {
      const q = o.flowP[i], vcol = (st.air.col[q.j] / 1.25 / (R.dy * R.dz)) * 3;
      q.s = (q.s + vcol * dts) % loopLen;
      let x, h, s = q.s, zoneT;
      if (s < LA) { x = x1 - s; h = H - 0.5 + q.v * 0.35; }
      else if ((s -= LA) < LB) { x = x0; h = H - 0.5 - s; }
      else if ((s -= LB) < LA) { x = x0 + s; h = 0.3 + q.v * 1.0; }
      else { s -= LA; x = x1 + 0.2; h = 0.5 + s; }
      const y = (q.j + 0.5) * R.dy + q.lat * R.dy * 0.3;
      pos[i * 3] = o.X(x); pos[i * 3 + 1] = h; pos[i * 3 + 2] = o.Z(y);
      if (q.s < 1.2) zoneT = st.evapOut.Tsup;
      else { const zi = Math.min(R.nx - 1, Math.max(0, Math.floor(x / R.dx))); zoneT = st.T[R.zid(zi, q.j, h > H / 2 ? 1 : 0)]; }
      const c = heatRGB(zoneT, p.sp, p.alarmOffset);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    o.flow.geometry.attributes.position.needsUpdate = true; o.flow.geometry.attributes.color.needsUpdate = true;
    o.flow.material.opacity = st.air.fanFrac > 0 ? 0.9 : 0.25;
  }

  function updateDoorFlow(st, p, dts) {
    const o = W3, pos = o.doorPts.geometry.attributes.position.array, col = o.doorPts.geometry.attributes.color.array;
    const f = st.door.frac, dw = o.dw * f * 0.95, dh = Math.min(p.doorH, p.H - 0.3), rate = (st.door.mInf / 0.9) * 60;
    const warm = heatRGB(p.tExt, p.sp, p.alarmOffset), cold = heatRGB(st.T[o.R.doorZone], p.sp, p.alarmOffset);
    let spawn = rate * dts;
    for (let i = 0; i < o.doorP.length; i++) {
      const q = o.doorP[i];
      if (q.life <= 0 && spawn > 0 && f > 0.05 && Math.random() < spawn / 20) {
        spawn -= 1; q.life = 5;
        q.y = (Math.random() - 0.5) * dw;
        if (q.inflow) { q.x = -0.8 - Math.random() * 0.6; q.h = dh * (0.55 + Math.random() * 0.4); }
        else { q.x = 0.3 + Math.random() * 0.6; q.h = 0.1 + Math.random() * dh * 0.4; }
      }
      if (q.life > 0) {
        q.life -= dts; q.x += (q.inflow ? 1.1 : -1.1) * dts; if (q.inflow) q.h -= 0.12 * dts;
        pos[i * 3] = o.X(q.x); pos[i * 3 + 1] = q.h; pos[i * 3 + 2] = q.y;
        const c = q.inflow ? warm : cold; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      } else { pos[i * 3 + 1] = -50; }
    }
    o.doorPts.geometry.attributes.position.needsUpdate = true; o.doorPts.geometry.attributes.color.needsUpdate = true;
  }

  function updateSelection(st, p) {
    const b = W3.selBox, sel = S.sel;
    if (!sel) { b.visible = false; return; }
    const box = b.box;
    if (sel.kind === 'pallet') {
      const q = st.pallets.find((x) => x.id === sel.id);
      if (!q) { b.visible = false; return; }
      const ps = palletPos(q, W3.R, p), x = W3.X(ps.x), z = W3.Z(ps.y);
      box.min.set(x - SLOT.palletW / 2 - 0.05, ps.h, z - SLOT.palletD / 2 - 0.05); box.max.set(x + SLOT.palletW / 2 + 0.05, ps.h + SLOT.palletH + 0.2, z + SLOT.palletD / 2 + 0.05);
    } else if (sel.kind === 'sensor') { const s = W3.sensors.find((x) => x.id === sel.id); box.setFromCenterAndSize(s.mesh.position, tmpV.set(0.5, 0.5, 0.5)); }
    else if (sel.kind === 'evap') box.setFromObject(W3.evapBody);
    else if (sel.kind === 'door') box.setFromObject(W3.door);
    else if (sel.kind === 'zone') box.setFromObject(W3.heat[sel.id]);
    b.visible = true;
  }

  function select(sel) { S.sel = sel; }

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  });
  ro.observe(container);

  return { build, update, setView, setLayers, setLevel, select, get view() { return S.view; }, get layers() { return S.layers; } };
}
