//! SPIKE: the same stroke as the browser spike's latency test, natively, to tell the engine's own cost from WebAssembly's.
//!   cargo run --release --example bench
use std::time::Instant;

use color::PixelFormat;
use paint::{BrushSettings, StrokePoint, render::StrokeRenderer};
use raster::Surface;

fn main() {
    for size in [std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(500.0f32)] {
        let brush: BrushSettings = serde_json::from_str(&format!(r#"{{"size":{size},"hardness":1.0,"spacing":0.1,"color":[0.1,0.3,0.8,1]}}"#)).unwrap_or_default();
        let mut target = Surface::new(PixelFormat::RGBA8);
        let pre = target.clone();
        let mut r = StrokeRenderer::new(&brush, Some(target.format()), 1.0);
        let mut worst = 0f64;
        let mut total = 0f64;
        let mut push_ms = 0f64;
        for f in 0..240 {
            let pts: Vec<StrokePoint> = (0..4).map(|i| StrokePoint::new(40.0 + ((f * 4 + i) * 6) as f64, 400.0, 0.8)).collect();
            let t = Instant::now();
            r.push(&pts);
            push_ms += t.elapsed().as_secs_f64() * 1000.0;
            r.composite(&pre, &mut target, None, false, false);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            worst = worst.max(ms);
            total += ms;
        }
        println!("size {size}: {:.1} ms for 240 frames (push, i.e. dabs into the coverage: {push_ms:.1} ms; composite: {:.1} ms), worst frame {worst:.1} ms, dabs {}", total, total - push_ms, r.dab_count());
    }
}
