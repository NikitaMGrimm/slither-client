//! Original synthetic viewport contract; CPU-only actual finish/atlas, no GPU.
use slither_wgpu_slice::{bank::Bank, frame::Frame, render};
fn bounded(extent: [u32; 2], scale: f64) {
    let mut bank = Bank::new().unwrap();
    let frame = Frame {
        identity: 1,
        tick: 0,
        extent,
        viewport_scale: scale,
        draws: Vec::new(),
    };
    let out = render::finish(
        frame,
        &mut bank,
        "LENGTH 123456\nCONNECTED\nRANK 5 / 100\nFINAL 500",
    )
    .unwrap();
    let w = f64::from(extent[0]) / scale;
    let h = f64::from(extent[1]) / scale;
    for d in &out.frame.draws {
        assert!(d.destination.x >= 0. && d.destination.y >= 0.);
        assert!(
            d.destination.x + d.destination.width <= w,
            "HUD extends outside width"
        );
        assert!(
            d.destination.y + d.destination.height <= h,
            "HUD extends outside height"
        );
    }
    if extent.contains(&0) || w < 48. || h < 40. {
        assert!(out.frame.draws.is_empty());
    }
    assert!(bank.hud.asset.width <= 512 && bank.hud.asset.height <= 512);
}
#[test]
fn tiny_viewport_hud_is_clipped() {
    bounded([64, 48], 1.);
}
#[test]
fn high_scale_hud_is_bounded() {
    bounded([1920, 1080], 32.);
}
#[test]
fn zero_extent_has_no_hud_submission() {
    bounded([0, 540], 1.);
}
#[test]
fn ordinary_viewport_control() {
    bounded([960, 540], 1.);
}
