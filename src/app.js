const DATA = __DATA__;
const ICON_PATHS = __ICONS__;
const FIT_BOX = [204, 1236, 10036, 6444];
const SEAT_SIZE = 1;
const UNAVAILABLE_SCALE = 0.85;
const SECTION_STROKE = 8;
const VEIL_OPACITY = 0.15;
const TRANSITION_MS = 500;
const SHOW_ALL_SEATS_K = 2.2;
const MIN_K = 0.03;
const MAX_K = 60;
const DRAG_THRESHOLD = 4;
const HISTORY_LIMIT = 200;
const FLIGHT_MS = 350;
const SECTION_PAD = 0.12;
const CLOSE_ENOUGH = 0.6;
const AUTO_CLOSE = 0.35;
const OPEN_GUARD_MS = 400;
const PAN_STEP = 80;
const PAN_KEYS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const STORAGE_KEY = "apgp-seat-planner-v2";
const SEAT_GREY = "#bfbfbf";
const SECTION_GREY = "#949494";
const WHITE = "#ffffff";
const LABEL_FONT = "'TM Sans', Arial, 'Lucida Console', sans-serif";
const COLOURS = [
    { name: "Standard", hex: "#2a55d9" },
    { name: "VIP", hex: "#ffb932", icon: "vip" },
    { name: "Resale", hex: "#d0006f", icon: "resale" },
    { name: "Selected", hex: "#121212", icon: "selected" },
    { name: "Purple", hex: "#8e3bd6" },
    { name: "Green", hex: "#1fa64a" },
    { name: "Red", hex: "#e0262f" },
    { name: "Orange", hex: "#ff7a00" },
];
const ERASER = -1;
const ICONS = Object.fromEntries(Object.entries(ICON_PATHS).map(([k, d]) => [k, new Path2D(d)]));

const hexToRgb = (hex) => [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16));
const rgbToCss = ([r, g, b]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
const mix = (a, b, t) => {
    const x = hexToRgb(a);
    const y = hexToRgb(b);
    return rgbToCss(x.map((v, i) => v + (y[i] - v) * t));
};
const shade = (hex) => mix(hex, "#000000", 0.25);
const tint = (hex) => mix(hex, "#ffffff", 0.5);

let n = 0;
DATA.forEach((s) => s.r.forEach((r) => (n += r[1].length / 3)));
const X = new Float32Array(n);
const Y = new Float32Array(n);
const NUM = new Uint16Array(n);
const ROW = new Uint32Array(n);
const SEC = new Uint16Array(n);
const rows = [];
const sections = [];
let idx = 0;
DATA.forEach((s, si) => {
    const sec = { name: s.n, code: s.c, path: new Path2D(s.p), b: s.b, labels: s.l, start: idx, rows: [], cover: 1, fill: SECTION_GREY };
    s.r.forEach(([rowName, a]) => {
        const row = { name: rowName, sec: si, start: idx, end: 0 };
        for (let i = 0; i < a.length; i += 3) {
            NUM[idx] = a[i];
            X[idx] = a[i + 1] / 10;
            Y[idx] = a[i + 2] / 10;
            ROW[idx] = rows.length;
            SEC[idx] = si;
            idx++;
        }
        row.end = idx;
        sec.rows.push(rows.length);
        rows.push(row);
    });
    sec.end = idx;
    sections.push(sec);
});

const seatKey = (i) => `${sections[SEC[i]].code}|${rows[ROW[i]].name}|${NUM[i]}`;
const keyIndex = new Map();
for (let i = 0; i < n; i++) keyIndex.set(seatKey(i), i);

const colourOf = new Int8Array(n).fill(-1);
const seatAnims = new Map();
const activeSections = new Set();
let labels = COLOURS.map(() => "");
let active = 0;

const $ = (id) => document.getElementById(id);
const mapEl = $("map");
const cv = $("cv");
const ctx = cv.getContext("2d");
const bg = $("bg");
const tip = $("tip");
let W = 0;
let H = 0;
let dpr = 1;
const view = { k: 0, tx: 0, ty: 0 };
let hoverSeat = -1;
let hoverSection = -1;
let paintMode = false;
let dirty = true;
let lastFrame = performance.now();

const toMap = (sx, sy) => [(sx - view.tx) / view.k, (sy - view.ty) / view.k];

const resize = () => {
    const r = mapEl.getBoundingClientRect();
    W = r.width;
    H = r.height;
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    dirty = true;
};

let flight = null;
let openedAt = -Infinity;

const stopFlight = () => {
    flight = null;
};

const fitScale = (b, pad) => Math.min(MAX_K, Math.min(W / ((b[2] - b[0]) * (1 + pad * 2)), H / ((b[3] - b[1]) * (1 + pad * 2))));

const setCamera = (cx, cy, k) => {
    view.k = k;
    view.tx = W / 2 - cx * k;
    view.ty = H / 2 - cy * k;
    dirty = true;
};

// Interpolate the centre linearly and the scale in log space so zooming feels even.
const stepFlight = (now) => {
    if (!flight) return;
    const t = Math.min(1, (now - flight.t0) / FLIGHT_MS);
    const ease = 1 - (1 - t) ** 3;
    const k = Math.exp(Math.log(flight.from.k) + (Math.log(flight.to.k) - Math.log(flight.from.k)) * ease);
    setCamera(flight.from.cx + (flight.to.cx - flight.from.cx) * ease, flight.from.cy + (flight.to.cy - flight.from.cy) * ease, k);
    if (t >= 1) flight = null;
};

const fitBox = (b, pad = 0.08, animate = false) => {
    if (!W || !H) return;
    const k = fitScale(b, pad);
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    if (!animate || reducedMotion.matches || !(view.k > 0)) {
        stopFlight();
        setCamera(cx, cy, k);
        return;
    }
    const [fromX, fromY] = toMap(W / 2, H / 2);
    flight = { t0: performance.now(), from: { cx: fromX, cy: fromY, k: view.k }, to: { cx, cy, k } };
};

const zoomAt = (sx, sy, factor) => {
    stopFlight();
    const k = Math.max(MIN_K, Math.min(MAX_K, view.k * factor));
    const [mx, my] = toMap(sx, sy);
    view.k = k;
    view.tx = sx - mx * k;
    view.ty = sy - my * k;
    dirty = true;
};

const intersects = (s, x0, y0, x1, y1) => s.b[2] >= x0 && s.b[0] <= x1 && s.b[3] >= y0 && s.b[1] <= y1;
const showsSeats = (si) => activeSections.has(si) || view.k >= SHOW_ALL_SEATS_K;
const seatsOpen = (si) => sections[si].cover < 0.5;

const seatLook = (i, now) => {
    const c = colourOf[i];
    const anim = seatAnims.get(i);
    const toHex = c >= 0 ? COLOURS[c].hex : SEAT_GREY;
    const toR = c >= 0 ? SEAT_SIZE : SEAT_SIZE * UNAVAILABLE_SCALE;
    if (!anim) return { fill: i === hoverSeat && c >= 0 ? shade(toHex) : toHex, r: toR, icon: c >= 0 ? COLOURS[c].icon : null };
    const t = Math.min(1, (now - anim.t0) / TRANSITION_MS);
    if (t >= 1) seatAnims.delete(i);
    return { fill: mix(anim.fromHex, toHex, t), r: anim.fromR + (toR - anim.fromR) * t, icon: t > 0.5 && c >= 0 ? COLOURS[c].icon : anim.fromIcon };
};

const drawIconSeat = (x, y, r, fill, icon) => {
    ctx.save();
    ctx.translate(x - r, y - r);
    ctx.scale(r / 50, r / 50);
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (icon === "selected") {
        ctx.translate(15, 20);
        ctx.scale(0.7, 0.7);
    }
    ctx.fillStyle = WHITE;
    ctx.fill(ICONS[icon]);
    ctx.restore();
};

const draw = (now) => {
    if (!(view.k > 0)) return;
    const { k, tx, ty } = view;
    bg.setAttribute("viewBox", `${-tx / k} ${-ty / k} ${W / k} ${H / k}`);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
    const [x0, y0] = toMap(0, 0);
    const [x1, y1] = toMap(W, H);
    const pad = SECTION_STROKE;
    const inView = [];
    sections.forEach((s, si) => {
        if (intersects(s, x0 - pad, y0 - pad, x1 + pad, y1 + pad)) inView.push(si);
    });

    const grey = new Path2D();
    const solid = new Map();
    const special = [];
    inView.forEach((si) => {
        const s = sections[si];
        if (s.cover >= 0.999) return;
        for (let i = s.start; i < s.end; i++) {
            if (X[i] < x0 - 2 || X[i] > x1 + 2 || Y[i] < y0 - 2 || Y[i] > y1 + 2) continue;
            const c = colourOf[i];
            if (seatAnims.has(i) || i === hoverSeat || (c >= 0 && COLOURS[c].icon)) {
                special.push(i);
            } else if (c < 0) {
                const r = SEAT_SIZE * UNAVAILABLE_SCALE;
                grey.moveTo(X[i] + r, Y[i]);
                grey.arc(X[i], Y[i], r, 0, Math.PI * 2);
            } else {
                if (!solid.has(c)) solid.set(c, new Path2D());
                const p = solid.get(c);
                p.moveTo(X[i] + SEAT_SIZE, Y[i]);
                p.arc(X[i], Y[i], SEAT_SIZE, 0, Math.PI * 2);
            }
        }
    });
    ctx.fillStyle = SEAT_GREY;
    ctx.fill(grey);
    solid.forEach((p, c) => {
        ctx.fillStyle = COLOURS[c].hex;
        ctx.fill(p);
    });
    special.forEach((i) => {
        let look = seatLook(i, now);
        if (i === hoverSeat && colourOf[i] < 0 && active !== ERASER && !seatAnims.has(i)) {
            look = { fill: tint(COLOURS[active].hex), r: SEAT_SIZE, icon: null };
        }
        if (look.icon) {
            drawIconSeat(X[i], Y[i], look.r, look.fill, look.icon);
        } else {
            ctx.beginPath();
            ctx.arc(X[i], Y[i], look.r, 0, Math.PI * 2);
            ctx.fillStyle = look.fill;
            ctx.fill();
        }
    });

    ctx.lineJoin = "round";
    inView.forEach((si) => {
        const s = sections[si];
        const solidFill = si === hoverSection && s.cover > 0.5 ? shade(s.fill) : s.fill;
        ctx.globalAlpha = VEIL_OPACITY + (1 - VEIL_OPACITY) * s.cover;
        ctx.fillStyle = mix(WHITE, solidFill, s.cover);
        ctx.fill(s.path);
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = SECTION_STROKE;
        ctx.stroke(s.path);
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = WHITE;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    inView.forEach((si) => {
        const s = sections[si];
        if (showsSeats(si)) return;
        s.labels.forEach(([text, lx, ly, size, angle]) => {
            ctx.save();
            ctx.translate(lx, ly);
            if (angle) ctx.rotate((-angle * Math.PI) / 180);
            ctx.font = `bold ${size}px ${LABEL_FONT}`;
            String(text)
                .split("\n")
                .forEach((line, li) => ctx.fillText(line, 0, (li + 1) * size));
            ctx.restore();
        });
    });

    $("hint").hidden = view.k >= SHOW_ALL_SEATS_K || activeSections.size > 0 || colourCount() > 0;
};

// Close stands once they're small on screen again; skipped mid-flight because a fly-in starts zoomed out.
const closeDistantSections = () => {
    if (flight) return;
    activeSections.forEach((si) => {
        if (view.k < fitScale(sections[si].b, SECTION_PAD) * AUTO_CLOSE) activeSections.delete(si);
    });
};

const stepCovers = (dt) => {
    closeDistantSections();
    let moving = false;
    const step = dt / TRANSITION_MS;
    sections.forEach((s, si) => {
        const target = showsSeats(si) ? 0 : 1;
        if (s.cover === target) return;
        s.cover = target > s.cover ? Math.min(target, s.cover + step) : Math.max(target, s.cover - step);
        moving = true;
    });
    return moving;
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const loop = (now) => {
    const dt = reducedMotion.matches ? TRANSITION_MS : now - lastFrame;
    lastFrame = now;
    stepFlight(now);
    const moving = stepCovers(dt) || flight !== null;
    if (reducedMotion.matches) seatAnims.clear();
    if (dirty || moving || seatAnims.size) {
        dirty = false;
        draw(now);
    }
    requestAnimationFrame(loop);
};

const seatAt = (sx, sy) => {
    const [mx, my] = toMap(sx, sy);
    const reach = Math.max(SEAT_SIZE * 1.25, 6 / view.k);
    let best = -1;
    let bestD = reach * reach;
    sections.forEach((s, si) => {
        if (!seatsOpen(si) || !intersects(s, mx - reach, my - reach, mx + reach, my + reach)) return;
        for (let i = s.start; i < s.end; i++) {
            const d = (X[i] - mx) ** 2 + (Y[i] - my) ** 2;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
    });
    return best;
};

const sectionAt = (sx, sy) => {
    const [mx, my] = toMap(sx, sy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const exact = sections.findIndex((s) => ctx.isPointInPath(s.path, mx, my));
    dirty = true;
    if (exact >= 0) return exact;
    const slack = 8 / view.k;
    let best = -1;
    let bestArea = Infinity;
    sections.forEach((s, si) => {
        if (!intersects(s, mx - slack, my - slack, mx + slack, my + slack)) return;
        const area = (s.b[2] - s.b[0]) * (s.b[3] - s.b[1]);
        if (area < bestArea) {
            bestArea = area;
            best = si;
        }
    });
    return best;
};

const colourCount = () => {
    let c = 0;
    for (let i = 0; i < n; i++) if (colourOf[i] >= 0) c++;
    return c;
};

const setSeat = (i, c) => {
    const prev = colourOf[i];
    if (prev === c) return false;
    seatAnims.set(i, {
        t0: performance.now(),
        fromHex: prev >= 0 ? COLOURS[prev].hex : SEAT_GREY,
        fromR: prev >= 0 ? SEAT_SIZE : SEAT_SIZE * UNAVAILABLE_SCALE,
        fromIcon: prev >= 0 ? COLOURS[prev].icon : null,
    });
    colourOf[i] = c;
    return true;
};

const updateSectionFills = () => {
    sections.forEach((s) => {
        const counts = COLOURS.map(() => 0);
        for (let i = s.start; i < s.end; i++) if (colourOf[i] >= 0) counts[colourOf[i]]++;
        const top = counts.indexOf(Math.max(...counts));
        s.fill = counts[top] > 0 ? COLOURS[top].hex : SECTION_GREY;
    });
};

const undoStack = [];
const redoStack = [];
let baseline = colourOf.slice();

const seatsWord = (count) => `${count} seat${count === 1 ? "" : "s"}`;

const updateHistoryButtons = () => {
    $("undo").disabled = undoStack.length === 0;
    $("redo").disabled = redoStack.length === 0;
};

const applied = () => {
    baseline = colourOf.slice();
    updateSectionFills();
    dirty = true;
    save();
    renderPanel();
    updateHistoryButtons();
};

const commit = () => {
    const changes = [];
    for (let i = 0; i < n; i++) if (colourOf[i] !== baseline[i]) changes.push([i, baseline[i], colourOf[i]]);
    if (changes.length) {
        undoStack.push(changes);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack.length = 0;
    }
    applied();
};

const stepHistory = (from, to, forward) => {
    const changes = from.pop();
    if (!changes) return 0;
    changes.forEach(([i, prev, next]) => setSeat(i, forward ? next : prev));
    to.push(changes);
    applied();
    return changes.length;
};

const undo = () => {
    const count = stepHistory(undoStack, redoStack, false);
    flash(count ? `Undid ${seatsWord(count)}.` : "Nothing to undo.");
};

const redo = () => {
    const count = stepHistory(redoStack, undoStack, true);
    flash(count ? `Redid ${seatsWord(count)}.` : "Nothing to redo.");
};

const clickSeat = (i) => {
    const next = active === ERASER || colourOf[i] === active ? -1 : active;
    setSeat(i, next);
    commit();
};

const fillRow = (i) => {
    const row = rows[ROW[i]];
    const next = active === ERASER ? -1 : active;
    for (let j = row.start; j < row.end; j++) setSeat(j, next);
    commit();
};

const openSection = (si, alwaysMove = false) => {
    activeSections.add(si);
    openedAt = performance.now();
    const s = sections[si];
    const [x0, y0] = toMap(0, 0);
    const [x1, y1] = toMap(W, H);
    const alreadyClose = view.k >= fitScale(s.b, SECTION_PAD) * CLOSE_ENOUGH && intersects(s, x0, y0, x1, y1);
    if (alwaysMove || !alreadyClose) fitBox(s.b, SECTION_PAD, true);
};

const describe = (i) => `${sections[SEC[i]].name} · Row ${rows[ROW[i]].name} · Seat ${NUM[i]}`;

const pointers = new Map();
let gesture = null;
let lastPaint = -1;

const localPoint = (e) => {
    const r = mapEl.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
};

mapEl.addEventListener("pointerdown", (e) => {
    mapEl.setPointerCapture(e.pointerId);
    const [x, y] = localPoint(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        stopFlight();
        gesture = { type: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: view.tx, ty: view.ty };
        return;
    }
    stopFlight();
    gesture = { type: paintMode || e.shiftKey ? "paint" : "pan", sx: x, sy: y, tx: view.tx, ty: view.ty, moved: false };
    lastPaint = -1;
});

mapEl.addEventListener("pointermove", (e) => {
    const [x, y] = localPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (gesture?.type === "pinch" && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const k = Math.max(MIN_K, Math.min(MAX_K, gesture.k * (dist / gesture.dist)));
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const mx = (gesture.cx - gesture.tx) / gesture.k;
        const my = (gesture.cy - gesture.ty) / gesture.k;
        view.k = k;
        view.tx = cx - mx * k;
        view.ty = cy - my * k;
        dirty = true;
        return;
    }
    if (gesture && pointers.size === 1) {
        if (!gesture.moved && Math.hypot(x - gesture.sx, y - gesture.sy) > DRAG_THRESHOLD) {
            gesture.moved = true;
            if (gesture.type === "pan") mapEl.classList.add("dragging");
        }
        if (gesture.moved && gesture.type === "pan") {
            view.tx = gesture.tx + (x - gesture.sx);
            view.ty = gesture.ty + (y - gesture.sy);
            dirty = true;
        }
        if (gesture.type === "paint") {
            const i = seatAt(x, y);
            if (i >= 0 && i !== lastPaint) {
                lastPaint = i;
                if (setSeat(i, active === ERASER ? -1 : active)) dirty = true;
            }
        }
    }
    updateHover(x, y, e.pointerType);
});

const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const [x, y] = localPoint(e);
    pointers.delete(e.pointerId);
    mapEl.classList.remove("dragging");
    if (!gesture) return;
    if (gesture.type === "pinch") {
        if (pointers.size === 0) gesture = null;
        return;
    }
    if (gesture.type === "paint" && gesture.moved) {
        commit();
    } else if (!gesture.moved) {
        handleClick(x, y);
    }
    gesture = null;
};
mapEl.addEventListener("pointerup", endPointer);
mapEl.addEventListener("pointercancel", endPointer);

const justOpened = () => performance.now() - openedAt < OPEN_GUARD_MS;

const handleClick = (x, y) => {
    const si = sectionAt(x, y);
    if (si >= 0 && !seatsOpen(si)) return openSection(si);
    const i = seatAt(x, y);
    if (i >= 0 && !justOpened()) clickSeat(i);
};

mapEl.addEventListener("dblclick", (e) => {
    if (justOpened()) return;
    const [x, y] = localPoint(e);
    const i = seatAt(x, y);
    if (i >= 0) fillRow(i);
});

mapEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    stopFlight();
    const [x, y] = localPoint(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(x, y, Math.exp(-delta * 0.0015));
}, { passive: false });

mapEl.addEventListener("pointerleave", () => {
    tip.hidden = true;
    if (hoverSeat !== -1 || hoverSection !== -1) {
        hoverSeat = -1;
        hoverSection = -1;
        dirty = true;
    }
});

const updateHover = (x, y, type) => {
    if (type === "touch") return;
    let text = "";
    const seat = seatAt(x, y);
    let sec = -1;
    if (seat < 0) {
        const si = sectionAt(x, y);
        if (si >= 0 && !seatsOpen(si)) sec = si;
    }
    if (seat >= 0) text = describe(seat) + (colourOf[seat] >= 0 ? ` · ${labelFor(colourOf[seat])}` : "");
    else if (sec >= 0) text = `${sections[sec].name} · ${sections[sec].end - sections[sec].start} seats`;
    if (seat !== hoverSeat || sec !== hoverSection) {
        hoverSeat = seat;
        hoverSection = sec;
        dirty = true;
    }
    mapEl.style.cursor = seat >= 0 || sec >= 0 ? "pointer" : "";
    tip.hidden = !text;
    if (text) {
        tip.textContent = text;
        const flip = x > W - 260;
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
        tip.style.transform = flip ? "translate(calc(-100% - 12px), 12px)" : "translate(12px, 12px)";
    }
};

window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
        if (key === "z") {
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
        } else if (key === "y") {
            e.preventDefault();
            redo();
        }
        return;
    }
    if (e.altKey) return;
    const digit = Number(e.key);
    if (digit >= 1 && digit <= COLOURS.length) setActive(digit - 1);
    if (key === "0" || key === "e") setActive(ERASER);
    if (key === "p") togglePaint();
    if (key === "+" || key === "=") zoomAt(W / 2, H / 2, 1.6);
    if (key === "-") zoomAt(W / 2, H / 2, 1 / 1.6);
    if (key === "escape") {
        if (paintMode) togglePaint();
        else showWholeCircuit();
    }
    const pan = PAN_KEYS[e.key];
    if (pan) {
        e.preventDefault();
        stopFlight();
        view.tx += pan[0] * PAN_STEP;
        view.ty += pan[1] * PAN_STEP;
        dirty = true;
    }
});

const labelFor = (c) => labels[c].trim() || COLOURS[c].name;

const setActive = (c) => {
    active = c;
    document.querySelectorAll(".sw").forEach((el) => el.classList.toggle("active", Number(el.dataset.c) === c));
    dirty = true;
    save();
};

const chipSvg = (col) => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "50");
    circle.setAttribute("cy", "50");
    circle.setAttribute("r", "50");
    circle.setAttribute("fill", col.hex);
    svg.appendChild(circle);
    if (col.icon) {
        const path = document.createElementNS(ns, "path");
        path.setAttribute("d", ICON_PATHS[col.icon]);
        path.setAttribute("fill", WHITE);
        if (col.icon === "selected") path.setAttribute("transform", "translate(15 20) scale(0.7)");
        svg.appendChild(path);
    }
    return svg;
};

const buildSwatches = () => {
    const wrap = $("swatches");
    const items = [...COLOURS.map((col, c) => ({ col, c })), { col: null, c: ERASER }];
    items.forEach(({ col, c }) => {
        const el = document.createElement("div");
        el.className = `sw${c === ERASER ? " eraser" : ""}`;
        el.dataset.c = String(c);
        const chip = document.createElement("span");
        chip.className = "chip";
        if (col) chip.appendChild(chipSvg(col));
        el.appendChild(chip);
        if (col) {
            const input = document.createElement("input");
            input.id = `label-${c}`;
            input.placeholder = col.name;
            input.value = labels[c];
            input.setAttribute("aria-label", `Label for ${col.name}`);
            input.addEventListener("input", () => {
                labels[c] = input.value;
                save();
                renderPanel();
            });
            input.addEventListener("focus", () => setActive(c));
            el.appendChild(input);
        } else {
            const span = document.createElement("span");
            span.textContent = "Eraser";
            span.style.fontWeight = "500";
            el.appendChild(span);
        }
        const count = document.createElement("span");
        count.className = "count";
        count.id = `count-${c}`;
        el.appendChild(count);
        el.addEventListener("click", () => setActive(c));
        wrap.appendChild(el);
    });
    setActive(active);
};

const ranges = (nums) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const out = [];
    sorted.forEach((v) => {
        const last = out[out.length - 1];
        if (last && v === last[1] + 1) last[1] = v;
        else out.push([v, v]);
    });
    return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
};

const groupPicks = () => {
    const groups = new Map();
    for (let i = 0; i < n; i++) {
        const c = colourOf[i];
        if (c < 0) continue;
        const key = `${c}|${ROW[i]}`;
        if (!groups.has(key)) groups.set(key, { c, row: ROW[i], seats: [] });
        groups.get(key).seats.push(NUM[i]);
    }
    return [...groups.values()].sort((a, b) => a.c - b.c);
};

const renderPanel = () => {
    const counts = COLOURS.map(() => 0);
    for (let i = 0; i < n; i++) if (colourOf[i] >= 0) counts[colourOf[i]]++;
    COLOURS.forEach((_, c) => ($(`count-${c}`).textContent = counts[c] ? String(counts[c]) : ""));
    const wrap = $("picks");
    wrap.textContent = "";
    const groups = groupPicks();
    if (!groups.length) {
        const p = document.createElement("p");
        p.className = "empty";
        p.textContent = "No seats coloured yet. Click a grandstand, then click a seat.";
        wrap.appendChild(p);
    }
    groups.forEach((g) => {
        const row = rows[g.row];
        const btn = document.createElement("button");
        btn.className = "pick";
        btn.title = "Show on map";
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = COLOURS[g.c].hex;
        const where = document.createElement("span");
        where.className = "where";
        where.textContent = `${sections[row.sec].name} · Row ${row.name} · ${ranges(g.seats)}`;
        btn.append(dot, where);
        btn.addEventListener("click", () => {
            let b = [Infinity, Infinity, -Infinity, -Infinity];
            for (let i = row.start; i < row.end; i++) b = [Math.min(b[0], X[i]), Math.min(b[1], Y[i]), Math.max(b[2], X[i]), Math.max(b[3], Y[i])];
            const cx = (b[0] + b[2]) / 2;
            const cy = (b[1] + b[3]) / 2;
            activeSections.add(row.sec);
            fitBox([cx - 30, cy - 22, cx + 30, cy + 22], 0, true);
        });
        wrap.appendChild(btn);
    });
    $("backup").value = serialise();
};

const serialise = () => {
    const seats = {};
    for (let i = 0; i < n; i++) if (colourOf[i] >= 0) seats[seatKey(i)] = colourOf[i];
    return JSON.stringify({ labels, seats });
};

const restore = (text) => {
    const data = JSON.parse(text);
    colourOf.fill(-1);
    seatAnims.clear();
    if (Array.isArray(data.labels)) labels = COLOURS.map((_, c) => String(data.labels[c] ?? ""));
    let skipped = 0;
    Object.entries(data.seats || {}).forEach(([k, c]) => {
        const i = keyIndex.get(k);
        if (i === undefined || !(c >= 0 && c < COLOURS.length)) skipped++;
        else colourOf[i] = c;
    });
    COLOURS.forEach((_, c) => {
        const input = $(`label-${c}`);
        if (input) input.value = labels[c];
    });
    return skipped;
};

const save = () => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...JSON.parse(serialise()), active }));
    } catch (err) {
        console.warn("Could not save seats", err);
    }
};

const load = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        restore(raw);
        if (typeof data.active === "number") active = data.active;
    } catch (err) {
        console.warn("Could not load saved seats", err);
    }
};

const flash = (msg) => {
    $("status").textContent = msg;
};

const copyText = async (text, okMsg, fallbackEl) => {
    try {
        await navigator.clipboard.writeText(text);
        flash(okMsg);
    } catch {
        fallbackEl.closest("details")?.setAttribute("open", "");
        fallbackEl.value = text;
        fallbackEl.select();
        flash("Copying isn't allowed here. The text is selected, press Ctrl+C.");
    }
};

$("copy-list").addEventListener("click", () => {
    const groups = groupPicks();
    if (!groups.length) return flash("Nothing to copy yet.");
    const lines = [];
    COLOURS.forEach((_, c) => {
        const mine = groups.filter((g) => g.c === c);
        if (!mine.length) return;
        lines.push(`${labelFor(c)} (${mine.reduce((s, g) => s + g.seats.length, 0)})`);
        mine.forEach((g) => lines.push(`  ${sections[rows[g.row].sec].name}, Row ${rows[g.row].name}, Seats ${ranges(g.seats)}`));
    });
    copyText(lines.join("\n"), "Seat list copied.", $("backup"));
});

$("copy-backup").addEventListener("click", () => copyText(serialise(), "Backup copied.", $("backup")));

$("restore").addEventListener("click", () => {
    try {
        const skipped = restore($("backup").value);
        commit();
        flash(skipped ? `Restored. ${skipped} seats didn't match this map and were skipped.` : "Restored.");
    } catch {
        flash("That text isn't a valid backup. Paste the whole thing from Copy backup.");
    }
});

let clearArmed = null;
$("clear-all").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (!clearArmed) {
        btn.textContent = "Confirm clear";
        clearArmed = setTimeout(() => {
            btn.textContent = "Clear all";
            clearArmed = null;
        }, 3000);
        return;
    }
    clearTimeout(clearArmed);
    clearArmed = null;
    btn.textContent = "Clear all";
    for (let i = 0; i < n; i++) if (colourOf[i] >= 0) setSeat(i, -1);
    commit();
    flash("All seats cleared.");
});

const togglePaint = () => {
    paintMode = !paintMode;
    $("paint-toggle").setAttribute("aria-pressed", String(paintMode));
    mapEl.classList.toggle("paint", paintMode);
};

const showWholeCircuit = () => {
    activeSections.clear();
    fitBox(FIT_BOX, 0.02, true);
};

$("paint-toggle").addEventListener("click", togglePaint);
$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("zoom-in").addEventListener("click", () => zoomAt(W / 2, H / 2, 1.6));
$("zoom-out").addEventListener("click", () => zoomAt(W / 2, H / 2, 1 / 1.6));
$("zoom-fit").addEventListener("click", showWholeCircuit);

const jump = $("jump");
sections.forEach((s, si) => {
    const o = document.createElement("option");
    o.value = String(si);
    o.textContent = `${s.name} (${s.end - s.start})`;
    jump.appendChild(o);
});
jump.addEventListener("change", () => {
    if (jump.value !== "") openSection(Number(jump.value), true);
    jump.value = "";
});

$("total-seats").textContent = n.toLocaleString("en-AU");
load();
baseline = colourOf.slice();
updateSectionFills();
buildSwatches();
renderPanel();
updateHistoryButtons();
resize();
fitBox(FIT_BOX, 0.02);
new ResizeObserver(() => {
    if (!(view.k > 0) || !W || !H) {
        resize();
        fitBox(FIT_BOX, 0.02);
        return;
    }
    const [cx, cy] = toMap(W / 2, H / 2);
    resize();
    view.tx = W / 2 - cx * view.k;
    view.ty = H / 2 - cy * view.k;
}).observe(mapEl);
requestAnimationFrame(loop);
