//! Original synthetic runs; Windows tests rasterize the installed system Arial.
use slither_wgpu_slice::text::*;

fn run(text: &str) -> TextRun<'_> {
    TextRun {
        text,
        style: TextStyle {
            size: 15.,
            weight: Weight::Normal,
            color: [132, 182, 255],
        },
        position: [200., 100.],
        align: Align::Center,
        baseline: Baseline::Middle,
        alpha: 0.5,
    }
}
#[test]
fn rejects_invalid_runs_before_platform_work() {
    let mut cache = TextCache::default();
    assert!(cache.draw(run(""), 1.).unwrap().is_empty());
    for scale in [0., -1., f64::NAN, f64::INFINITY, 100.] {
        assert!(cache.draw(run("Name"), scale).is_err());
    }
    let mut bad = run("Name");
    bad.alpha = f64::NAN;
    assert!(cache.draw(bad, 1.).is_err());
    assert!(cache.draw(run(&"x".repeat(1025)), 1.).is_err());
    assert_eq!(cache.cached_runs(), 0);
}

#[cfg(windows)]
#[test]
fn native_arial_preserves_style_alpha_scale_and_evicted_frame_pixels() {
    use slither_wgpu_slice::{bank::Bank, frame::Frame};
    let mut cache = TextCache::default();
    let (first, resource) = cache.draw(run("AV café ÿ"), 1.).unwrap().remove(0);
    assert!(
        resource
            .image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[3] > 0)
    );
    for p in resource.image.pixels.as_chunks::<4>().0 {
        for c in 0..3 {
            assert!(p[c] <= p[3]);
        }
    }
    let mut moved = run("AV café ÿ");
    moved.alpha = 0.12;
    moved.position = [201.25, 99.5];
    let (second, _) = cache.draw(moved, 1.).unwrap().remove(0);
    assert_eq!(first.asset, second.asset);
    assert_eq!(first.destination, second.destination);
    assert_eq!(second.effective_alpha, 0.12);
    assert_eq!(second.translation, [201.25, 99.5]);
    assert_eq!(cache.cached_runs(), 1);
    let (scaled, _) = cache.draw(run("AV café ÿ"), 2.).unwrap().remove(0);
    assert_ne!(scaled.asset, first.asset);
    assert!((scaled.destination.width - first.destination.width).abs() < 2.);
    let mut bold = run("AV café ÿ");
    bold.style.weight = Weight::Bold;
    assert_ne!(cache.draw(bold, 1.).unwrap().remove(0).0.asset, first.asset);
    // A queued frame owns the old pixels even when the bounded LRU drops them.
    let mut bank = Bank::new().unwrap();
    bank.stage_text(1, vec![resource]).unwrap();
    for i in 0..300 {
        cache
            .draw(run(&format!("{i:03} WWWWWWWWWWWWWWWWWWWWWWWW")), 1.)
            .unwrap();
    }
    assert!(cache.cached_runs() <= CACHE_RUNS);
    assert!(cache.cached_bytes() <= CACHE_BYTES);
    let frame = Frame {
        identity: 1,
        extent: [960, 540],
        viewport_scale: 1.,
        tick: 0,
        draws: vec![first],
    };
    let resources = bank.resources(&frame).unwrap();
    frame
        .quads(
            &resources
                .iter()
                .map(|r| (r.asset.into(), r.asset))
                .collect(),
        )
        .unwrap();
    assert_ne!(
        cache.draw(run("AV café ÿ"), 1.).unwrap().remove(0).0.asset,
        frame.draws[0].asset
    );
    assert!(
        cache
            .draw(
                TextRun {
                    style: TextStyle {
                        size: 128.,
                        weight: Weight::Normal,
                        color: [255; 3]
                    },
                    ..run(&"W".repeat(100))
                },
                1.
            )
            .is_err()
    );
    let long_name = "ÿ".repeat(255);
    let tiles = cache.draw(run(&long_name), 2.).unwrap();
    assert!(tiles.len() > 1);
    for (_, resource) in &tiles {
        assert!(resource.asset.width <= 512);
    }
    for pair in tiles.windows(2) {
        let a = &pair[0].1.image;
        let b = &pair[1].1.image;
        for (left, right) in a
            .pixels
            .chunks_exact(a.width as usize * 4)
            .zip(b.pixels.chunks_exact(b.width as usize * 4))
        {
            assert_eq!(&left[left.len() - 8..], &right[..8]);
        }
        assert_eq!(
            pair[0].0.destination.x + pair[0].0.destination.width,
            pair[1].0.destination.x
        );
    }
}
