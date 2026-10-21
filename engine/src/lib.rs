//! The brush engine as WebAssembly (SPIKE, P0): a plain C interface, no generated glue, so the page loads it with
//! `WebAssembly.instantiate` and reads its memory directly. Layers are the engine's sparse surfaces (256 px tiles);
//! one stroke at a time. Every call that can fail returns a negative number instead of panicking.
use std::cell::RefCell;

use color::PixelFormat;
use geom::{Rect, TILE_SIZE, TileCoord};
use paint::{BrushSettings, StrokePoint, render::{COV_TILE, StrokeRenderer}};
use raster::Surface;

struct Stroke {
    layer: usize,
    pre: Surface,
    renderer: StrokeRenderer,
    lock: bool,
}

#[derive(Default)]
struct State {
    layers: Vec<Surface>,
    stroke: Option<Stroke>,
    /// The part of the layer the last call changed: x0, y0, x1, y1.
    dirty: [i32; 4],
    /// What `stroke_live` wrote: the tiles' pixels, their (tx, ty), and one tile of coverage as scratch.
    live: Vec<u8>,
    live_keys: Vec<i32>,
    cov: Vec<f32>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

/// Memory the page writes into (a brush as JSON, points, a file) or reads from (pixels).
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` and `len` come from one `alloc` call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(unsafe { Vec::from_raw_parts(ptr, 0, len.max(1)) });
}

/// A new, empty (transparent) 8-bit RGBA layer; its number.
#[unsafe(no_mangle)]
pub extern "C" fn layer_new() -> i32 {
    STATE.with_borrow_mut(|s| {
        s.layers.push(Surface::new(PixelFormat::RGBA8));
        (s.layers.len() - 1) as i32
    })
}

/// Start a stroke on `layer` with the brush given as the engine's JSON. -1: no such layer; -2: the brush does not read.
///
/// # Safety
/// `json` points to `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_begin(layer: i32, json: *const u8, len: usize, lock_alpha: i32) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(json, len) };
    let Ok(brush) = serde_json::from_slice::<BrushSettings>(bytes) else { return -2 };
    STATE.with_borrow_mut(|s| {
        let Some(surface) = s.layers.get(layer as usize) else { return -1 };
        let renderer = StrokeRenderer::new(&brush, Some(surface.format()), 1.0);
        s.stroke = Some(Stroke { layer: layer as usize, pre: surface.clone(), renderer, lock: lock_alpha != 0 });
        0
    })
}

/// One point from its 7 floats.
fn point(p: &[f32]) -> StrokePoint {
    StrokePoint { x: f64::from(p[0]), y: f64::from(p[1]), pressure: p[2], tilt_x: p[3], tilt_y: p[4], rotation: p[5], wheel: 1.0, time: f64::from(p[6]) }
}

fn composite(s: &mut State, finish: bool) -> i32 {
    let Some(st) = s.stroke.as_mut() else { return -1 };
    if finish {
        st.renderer.finish();
    }
    let Some(target) = s.layers.get_mut(st.layer) else { return -1 };
    let r: Rect = st.renderer.composite(&st.pre, target, None, st.lock, false);
    s.dirty = [r.x0, r.y0, r.x1, r.y1];
    i32::from(!r.is_empty())
}

/// Add points to the stroke: `n` × 7 floats (x, y, pressure 0..1, tilt x, tilt y in degrees, rotation, time ms). 1: pixels
/// changed (see `dirty`), 0: none, -1: no stroke.
///
/// # Safety
/// `pts` points to `n * 7` readable floats.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_push(pts: *const f32, n: usize) -> i32 {
    let f = unsafe { std::slice::from_raw_parts(pts, n * 7) };
    let points: Vec<StrokePoint> = f.chunks_exact(7).map(point).collect();
    STATE.with_borrow_mut(|s| {
        let Some(st) = s.stroke.as_mut() else { return -1 };
        st.renderer.push(&points);
        composite(s, false)
    })
}

/// Add points without putting the stroke on the layer (P0: the cost of the dabs alone, for a live view composited
/// outside the engine). Same input as `stroke_push`; 0, or -1 when there is no stroke.
///
/// # Safety
/// `pts` points to `n * 7` readable floats.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn stroke_feed(pts: *const f32, n: usize) -> i32 {
    let f = unsafe { std::slice::from_raw_parts(pts, n * 7) };
    let points: Vec<StrokePoint> = f.chunks_exact(7).map(point).collect();
    STATE.with_borrow_mut(|s| match s.stroke.as_mut() {
        Some(st) => {
            st.renderer.push(&points);
            0
        }
        None => -1,
    })
}

/// End the stroke (smoothing catches up) and put all of it on the layer: 1 with the changed part in `dirty`, 0 when
/// nothing changed, -1 without a stroke. (Whatever `stroke_live` already showed is put on the layer here, once.)
#[unsafe(no_mangle)]
pub extern "C" fn stroke_end() -> i32 {
    STATE.with_borrow_mut(|s| {
        let Some(mut st) = s.stroke.take() else { return -1 };
        st.renderer.finish();
        let Some(target) = s.layers.get_mut(st.layer) else { return -1 };
        let r = st.renderer.composite(&st.pre, target, None, st.lock, true);
        s.dirty = [r.x0, r.y0, r.x1, r.y1];
        i32::from(!r.is_empty())
    })
}

/// Drop the stroke: the layer is as it was before it. 0, or -1 without a stroke.
#[unsafe(no_mangle)]
pub extern "C" fn stroke_cancel() -> i32 {
    STATE.with_borrow_mut(|s| {
        let Some(st) = s.stroke.take() else { return -1 };
        if let Some(l) = s.layers.get_mut(st.layer) {
            *l = st.pre;
        }
        0
    })
}

/// The stroke as it is now, for a live view drawn outside the engine: the coverage tiles (`live_tile_size()` a side)
/// touched since the last call, as straight 8-bit RGBA, the brush's colour with an alpha of coverage × opacity (put over
/// the layer as it was: normally, inside its paint with alpha lock, or taken away when erasing). Returns how many tiles;
/// `live_keys_ptr()` holds their (tx, ty) pairs and `live_ptr()` their pixels, one after another. -1: no stroke.
#[unsafe(no_mangle)]
pub extern "C" fn stroke_live() -> i32 {
    STATE.with_borrow_mut(|s| {
        let State { stroke, live, live_keys, cov, .. } = s;
        let Some(st) = stroke.as_mut() else { return -1 };
        let keys = st.renderer.take_dirty_tiles();
        let n = (COV_TILE * COV_TILE) as usize;
        live.resize(keys.len() * n * 4, 0);
        live_keys.clear();
        cov.resize(n, 0.0);
        let b = &st.renderer.ctx.brush;
        let rgb = [0, 1, 2].map(|i| (b.color[i].clamp(0.0, 1.0) * 255.0 + 0.5) as u8);
        let k = b.opacity.clamp(0.0, 1.0) * b.color[3].clamp(0.0, 1.0) * 255.0;
        for (i, &(tx, ty)) in keys.iter().enumerate() {
            live_keys.extend([tx, ty]);
            st.renderer.coverage_tile(tx, ty, cov);
            for (o, &c) in live[i * n * 4..(i + 1) * n * 4].chunks_exact_mut(4).zip(cov.iter()) {
                o[..3].copy_from_slice(&rgb);
                o[3] = (c.min(1.0) * k + 0.5) as u8;
            }
        }
        keys.len() as i32
    })
}

/// The side of a live tile (see `stroke_live`).
#[unsafe(no_mangle)]
pub extern "C" fn live_tile_size() -> i32 {
    COV_TILE
}

/// Where `stroke_live` wrote its tiles' pixels.
#[unsafe(no_mangle)]
pub extern "C" fn live_ptr() -> *const u8 {
    STATE.with_borrow(|s| s.live.as_ptr())
}

/// Where `stroke_live` wrote its tiles' (tx, ty) pairs.
#[unsafe(no_mangle)]
pub extern "C" fn live_keys_ptr() -> *const i32 {
    STATE.with_borrow(|s| s.live_keys.as_ptr())
}

/// Empty a layer (no tiles), for loading another one into it. -1: no such layer.
#[unsafe(no_mangle)]
pub extern "C" fn layer_clear(layer: i32) -> i32 {
    STATE.with_borrow_mut(|s| match s.layers.get_mut(layer as usize) {
        Some(l) => {
            *l = Surface::new(PixelFormat::RGBA8);
            0
        }
        None => -1,
    })
}

/// The side of a tile in pixels (a tile is side × side × 4 bytes, straight RGBA, rows top to bottom).
#[unsafe(no_mangle)]
pub extern "C" fn tile_size() -> i32 {
    TILE_SIZE
}

/// Put a tile's pixels into a layer. -1: no such layer.
///
/// # Safety
/// `data` points to `tile_size()² × 4` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tile_put(layer: i32, tx: i32, ty: i32, data: *const u8) -> i32 {
    let n = (TILE_SIZE * TILE_SIZE * 4) as usize;
    let src = unsafe { std::slice::from_raw_parts(data, n) };
    STATE.with_borrow_mut(|s| match s.layers.get_mut(layer as usize) {
        Some(l) => {
            l.tile_mut(TileCoord { tx, ty }).bytes_mut().copy_from_slice(src);
            0
        }
        None => -1,
    })
}

/// Copy a tile's pixels out of a layer: 1 copied, 0 the layer has no such tile (it is empty), -1 no such layer.
///
/// # Safety
/// `out` points to `tile_size()² × 4` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tile_get(layer: i32, tx: i32, ty: i32, out: *mut u8) -> i32 {
    let n = (TILE_SIZE * TILE_SIZE * 4) as usize;
    let dst = unsafe { std::slice::from_raw_parts_mut(out, n) };
    STATE.with_borrow(|s| match s.layers.get(layer as usize) {
        Some(l) => match l.tile(TileCoord { tx, ty }) {
            Some(t) => {
                dst.copy_from_slice(t.bytes());
                1
            }
            None => 0,
        },
        None => -1,
    })
}

/// Where `dirty` is (4 × i32: x0, y0, x1, y1).
#[unsafe(no_mangle)]
pub extern "C" fn dirty_ptr() -> *const i32 {
    STATE.with_borrow(|s| s.dirty.as_ptr())
}

/// Copy a rectangle of a layer as straight 8-bit RGBA into `out` (w × h × 4 bytes). -1: no such layer.
///
/// # Safety
/// `out` points to `w * h * 4` writable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn read_rgba8(layer: i32, x: i32, y: i32, w: i32, h: i32, out: *mut u8) -> i32 {
    if w <= 0 || h <= 0 {
        return 0;
    }
    let px = unsafe { std::slice::from_raw_parts_mut(out.cast::<[u8; 4]>(), (w * h) as usize) };
    STATE.with_borrow(|s| {
        let Some(surface) = s.layers.get(layer as usize) else { return -1 };
        surface.read_rgba8_into(Rect { x0: x, y0: y, x1: x + w, y1: y + h }, px);
        0
    })
}

/// How many brushes an `.abr` file holds (tips and presets); -1 when it does not read.
///
/// # Safety
/// `data` points to `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn abr_count(data: *const u8, len: usize) -> i32 {
    let bytes = unsafe { std::slice::from_raw_parts(data, len) };
    match psd::abr::parse(bytes) {
        Ok(f) => (f.legacy.len() + f.samples.len().max(f.presets.len())) as i32,
        Err(_) => -1,
    }
}

/// A brush file written by the engine and read back (P0: `.abr` writing and reading work in the browser): `n` round tips
/// of different sizes as a v1 file, then parsed. The number of brushes read, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn abr_roundtrip(n: i32) -> i32 {
    use psd::abr::{LegacyBrush, LegacyTip, parse, write_v12};
    let brushes: Vec<LegacyBrush> = (0..n.max(0))
        .map(|i| LegacyBrush { name: String::new(), spacing: 25, anti_alias: true, tip: LegacyTip::Computed { diameter: (5 + i * 7) as u16, hardness: 80, angle: 0, roundness: 100 } })
        .collect();
    let Ok(bytes) = write_v12(1, &brushes, false) else { return -1 };
    match parse(&bytes) {
        Ok(f) => f.legacy.len() as i32,
        Err(_) => -1,
    }
}
