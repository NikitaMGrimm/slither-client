//! Original synthetic adapter contracts, no GPU/OS/browser/server execution.
use slither_client::{
    authored_sources::{CanvasRecipe, PaintCommand, authored_source_recipes},
    presentation::*,
};
use slither_wgpu_slice::{
    frame::*,
    materials::materialize,
    scene::{Driver, STEP_MS, Scene},
};
use std::collections::BTreeMap;
fn asset() -> BodyAsset {
    BodyAsset {
        handle: (1_u64 << 60) + 3,
        revision: u64::MAX - 2,
        width: 40,
        height: 20,
        status: BodyAssetStatus::Ready,
    }
}
fn draw() -> Draw {
    Draw {
        corners: None,
        asset: asset(),
        source: None,
        repeat_uv: None,
        destination: BodyRect {
            x: 0.,
            y: 0.,
            width: 40.,
            height: 20.,
        },
        translation: [50., 25.],
        rotation: 0.,
        effective_alpha: 0.375,
        blend: BodyBlend::SourceOver,
    }
}
fn frame(draws: Vec<Draw>) -> Frame {
    Frame {
        identity: 1,
        extent: [100, 100],
        viewport_scale: 1.,
        tick: 1,
        draws,
        snakes: Vec::new(),
    }
}
fn resident() -> BTreeMap<ResourceKey, BodyAsset> {
    BTreeMap::from([(asset().into(), asset())])
}
#[test]
fn repeat_uvs_cross_tile_seams_without_relaxing_image_crops() {
    let mut d = draw();
    d.repeat_uv = Some(BodyRect {
        x: -0.25,
        y: 0.5,
        width: 4.,
        height: 3.,
    });
    let q = frame(vec![d.clone()]).quads(&resident()).unwrap();
    assert!(q[0].repeat);
    assert_eq!(&q[0].vertices[0][2..4], &[-0.25, 0.5]);
    assert_eq!(&q[0].vertices[2][2..4], &[3.75, 3.5]);
    d.source = d.repeat_uv;
    assert!(frame(vec![d.clone()]).quads(&resident()).is_err());
    d.source = None;
    d.repeat_uv.as_mut().unwrap().x = f64::NAN;
    assert!(frame(vec![d]).quads(&resident()).is_err());
}
#[test]
fn full_u64_revision_identity_and_readiness() {
    let mut f = frame(vec![draw()]);
    assert!(f.quads(&resident()).is_ok());
    f.draws[0].asset.handle += 1;
    assert!(f.quads(&resident()).is_err());
    f.draws[0].asset = asset();
    f.draws[0].asset.revision -= 1;
    assert!(f.quads(&resident()).is_err());
    f.draws[0].asset = asset();
    f.draws[0].asset.status = BodyAssetStatus::Pending;
    assert!(f.quads(&resident()).is_err());
    f.draws[0].asset = asset();
    f.draws[0].asset.width += 1;
    assert!(f.quads(&resident()).is_err());
    assert!(f.quads(&BTreeMap::new()).is_err());
}
#[test]
fn transform_crop_alpha_and_exact_painter_order() {
    let a = draw();
    let mut b = a.clone();
    b.blend = BodyBlend::Lighter;
    b.rotation = std::f64::consts::FRAC_PI_2;
    b.source = Some(BodyRect {
        x: 10.,
        y: 5.,
        width: 20.,
        height: 10.,
    });
    let quads = frame(vec![a.clone(), b, a]).quads(&resident()).unwrap();
    assert_eq!(
        quads.iter().map(|q| q.blend).collect::<Vec<_>>(),
        vec![
            BodyBlend::SourceOver,
            BodyBlend::Lighter,
            BodyBlend::SourceOver
        ]
    );
    assert_eq!(quads[0].vertices[0], [0., 0.5, 0., 0., 0.375]);
    assert_eq!(quads[1].vertices[0], [0., 0.5, 0.25, 0.25, 0.375]);
    assert!((quads[1].vertices[1][1] + 0.3).abs() < 1e-6);
    assert_eq!(quads[0], quads[2]);
}
#[test]
fn rejects_invalid_values_without_partial_frame() {
    for alpha in [f64::NAN, -0.1, 1.1] {
        let mut d = draw();
        d.effective_alpha = alpha;
        assert!(frame(vec![draw(), d]).quads(&resident()).is_err());
    }
    let mut d = draw();
    d.translation[0] = f64::INFINITY;
    assert!(frame(vec![d]).quads(&resident()).is_err());
    let mut d = draw();
    d.source = Some(BodyRect {
        x: 39.,
        y: 0.,
        width: 2.,
        height: 1.,
    });
    assert!(frame(vec![d]).quads(&resident()).is_err());
    let mut f = frame(vec![draw()]);
    f.extent = [0, 100];
    assert!(f.quads(&resident()).unwrap().is_empty());
    f.extent = [MAX_EXTENT + 1, 100];
    assert!(f.quads(&resident()).is_err());
    let mut f = frame(vec![draw(); MAX_DRAWS + 1]);
    assert!(f.quads(&resident()).is_err());
    f.draws.clear();
    f.viewport_scale = f64::NAN;
    assert!(f.quads(&resident()).is_err());
}
#[test]
fn premultiplication_and_unsupported_operations_are_explicit() {
    let r = CanvasRecipe {
        width: 1,
        height: 1,
        half_width: 0.5,
        half_height: 0.5,
        commands: vec![PaintCommand::Pixels {
            width: 1,
            height: 1,
            rgba: vec![200, 100, 50, 128],
        }],
    };
    assert_eq!(materialize(&r).unwrap().pixels, [100, 50, 25, 128]);
    let mut invalid = r;
    invalid.commands.push(PaintCommand::Composite("xor"));
    assert!(materialize(&invalid).unwrap_err().contains("unsupported"));
}
#[test]
fn body_disk_is_covered_and_food_gradients_are_not_flat() {
    let r = authored_source_recipes();
    let b = materialize(&r.body_sources.palettes[0].variants[0]).unwrap();
    assert_eq!(b.pixels[3], 0);
    assert_eq!(b.pixels[(24 * 48 + 24) * 4 + 3], 255);
    let f = materialize(&r.food[0].bodies[5]).unwrap();
    let c = ((f.height / 2 * f.width + f.width / 2) * 4) as usize;
    assert!(f.pixels[c + 3] > f.pixels[3]);
    let o = materialize(&r.food[0].outlines[5]).unwrap();
    assert!(
        o.pixels
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| p[3] > 0 && p[3] < 255)
    );
    assert!(materialize(&r.body_sources.palettes[10].variants[0]).is_ok());
}
#[test]
fn shared_host_pacing_has_bounded_catchup_and_pause() {
    let mut d = Driver::default();
    assert_eq!(d.due(0.).unwrap(), 0);
    assert_eq!(d.due(STEP_MS * 3.5).unwrap(), 3);
    assert!(d.due(-1.).is_err());
    assert_eq!(d.due(1000.).unwrap(), 0);
    d.pause();
    assert_eq!(d.due(2000.).unwrap(), 0);
    assert_eq!(d.due(2200.).unwrap(), 8);
    assert!(d.due(2200.).unwrap() <= 8);
}
#[test]
fn actual_core_packet_schedule_normal_boost_food_and_repeatability() {
    let mut a = Scene::new().unwrap();
    let mut b = Scene::new().unwrap();
    let mut normal = 0;
    let mut boost = 0;
    let glow = ResourceKey {
        handle: 0x1000_0000_0000_0008,
        revision: 1,
    };
    for tick in 1..=240 {
        let fa = a.next_frame([960, 540], 1.).unwrap();
        let fb = b.next_frame([960, 540], 1.).unwrap();
        assert_eq!(fa, fb);
        let quads = fa.quads(&a.resident()).unwrap();
        assert!(!quads.is_empty());
        if tick == 60 {
            normal = quads.iter().filter(|q| q.key == glow).count();
        }
        if tick == 240 {
            boost = quads.iter().filter(|q| q.key == glow).count();
            assert!(quads.iter().any(|q| q.key.handle > glow.handle + 2));
        }
    }
    assert_eq!(normal, 0);
    assert!(
        boost > 0,
        "real core speed transition must produce boost passes"
    );
    let tick = a.tick();
    assert!(a.next_frame([0, 540], 1.).is_err());
    assert_eq!(a.tick(), tick);
    let resized = a.next_frame([1920, 1080], 2.).unwrap();
    assert_eq!(resized.tick, tick + 1);
    assert!(resized.quads(&a.resident()).is_ok());
}

#[test]
fn dpr_changes_backing_density_without_changing_core_view_or_food_sizes() {
    let mut a = Scene::new().unwrap();
    let mut b = Scene::new().unwrap();
    for _ in 0..32 {
        let fa = a.next_frame([960, 540], 1.).unwrap();
        let fb = b.next_frame([1920, 1080], 2.).unwrap();
        assert_eq!(
            fa.quads(&a.resident()).unwrap(),
            fb.quads(&b.resident()).unwrap()
        );
    }
    let tick = a.tick();
    assert!(a.next_frame([960, 540], 1e-300).is_err());
    assert_eq!(a.tick(), tick);
}

#[test]
fn finite_schedule_returns_to_normal_and_resize_does_not_restart_it() {
    let mut scene = Scene::new().unwrap();
    let mut last = None;
    for _ in 0..600 {
        last = Some(scene.next_frame([960, 540], 1.).unwrap());
    }
    let frame = last.unwrap();
    assert_eq!(frame.tick, 600);
    assert!(
        !frame
            .draws
            .iter()
            .any(|d| d.asset.handle == 0x1000_0000_0000_0008)
    );
    assert!(scene.next_frame([960, 540], 1.).is_err());
    assert_eq!(scene.tick(), 600);
    let resized = scene.draw_frame([1200, 700], 1.).unwrap();
    assert_eq!(resized.tick, 600);
    assert!(resized.identity > frame.identity);
    assert!(resized.quads(&scene.resident()).is_ok());
}

#[test]
fn zero_alpha_and_zero_destination_are_retained_in_order() {
    let mut zero = draw();
    zero.effective_alpha = -0.;
    zero.destination.width = 0.;
    let q = frame(vec![zero, draw()]).quads(&resident()).unwrap();
    assert_eq!(q.len(), 2);
    assert_eq!(q[0].vertices[0][4].to_bits(), (-0_f32).to_bits());
    assert_eq!(q[0].vertices[0][0], q[0].vertices[1][0]);
}

#[test]
fn canvas_radial_stops_interpolate_straight_rgba_before_premultiplication() {
    // Independent HTML Canvas rule: stop colors and alpha interpolate separately.
    // Pixel center(0.5,0.5) is halfway between radii0 and1 about(0,0.5).
    let r = CanvasRecipe {
        width: 1,
        height: 1,
        half_width: 0.5,
        half_height: 0.5,
        commands: vec![
            PaintCommand::RadialGradient {
                circles: [0., 0.5, 0., 0., 0.5, 1.],
                stops: vec![
                    (0., "rgba(255,0,0,1)".into()),
                    (1., "rgba(0,0,255,0)".into()),
                ],
            },
            PaintCommand::FillRect([0., 0., 1., 1.]),
        ],
    };
    assert_eq!(materialize(&r).unwrap().pixels, [64, 0, 64, 128]);
}
