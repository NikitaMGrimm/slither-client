//! Authored synthetic packets, world metadata and clocks; no external inputs.
//!
//! Test-local registration exercises the additive files before main exports them.

use slither_client::{presentation, state};

#[path = "../src/protocol/minimap.rs"]
pub(crate) mod minimap_protocol;
mod protocol {
    pub(crate) use crate::minimap_protocol as minimap;
}
#[path = "../src/presentation/minimap.rs"]
mod minimap;

use minimap::{
    MinimapComposite, MinimapError, MinimapLayout, MinimapState, MinimapUpdateInput, plan_minimap,
};
use minimap_protocol::{MinimapDecodeError, parse_minimap};
use presentation::{FrameClock, FrameStep};
use state::{Point, Setup};

fn setup() -> Setup {
    Setup {
        protocol: 19,
        grid_center: 1000.,
        radius: 900.,
        sector_size: 100,
        sector_count: 20,
        max_segments: 430,
        body_spacing: 42.,
        body_contraction: 0.43,
        spangdv: 4.8,
        nsp1: 5.39,
        nsp2: 0.4,
        nsp3: 14.,
        mamu: 0.033,
        mamu2: 0.028,
        server_number: Some(42),
        game_mode: Some(0),
        team: None,
    }
}

fn map() -> MinimapState {
    let mut map = MinimapState::default();
    map.apply_setup(&setup()).unwrap();
    map
}

fn apply(map: &mut MinimapState, command: &[u8]) {
    let packet = parse_minimap(command).unwrap();
    assert_eq!(packet.command(), command);
    map.apply_packet(packet).unwrap();
}

fn pixel(plane: &[u8], index: usize) -> [u8; 4] {
    plane[4 * index..4 * index + 4].try_into().unwrap()
}

fn input(now_ms: f64, delta: f64) -> MinimapUpdateInput {
    MinimapUpdateInput {
        now_ms,
        step: FrameStep {
            delta,
            unlagged_delta: delta,
            whole_steps: delta.floor() as u32,
            double_steps: (delta * 2.).floor() as u32,
            lag_multiplier: 1.,
            accumulated: delta,
            doubled_accumulated: delta * 2.,
        },
        connected: true,
        center: Some(1000.),
        displayed_radius: Some(900.),
        own_raw_head: None,
    }
}

#[test]
fn default_requires_setup_and_setup_forces_empty_24() {
    let mut state = MinimapState::default();
    assert_eq!(state.view().dimension, None);
    assert!(!state.view().entering);
    assert_eq!(state.view().fade, 0.);
    assert_eq!(
        state.apply_packet(parse_minimap(b"V").unwrap()),
        Err(MinimapError::MissingSetup)
    );
    assert_eq!(
        plan_minimap(state.view(), MinimapLayout::default())
            .unwrap()
            .widget,
        None
    );
    state.apply_setup(&setup()).unwrap();
    let view = state.view();
    assert_eq!(view.dimension, Some(24));
    assert_eq!(view.radius, Some(12.));
    assert_eq!(view.base_rgba, vec![0; 4 * 24 * 24]);
    assert_eq!(view.alternate_rgba, view.base_rgba);
    assert_eq!(view.toggles, vec![0; 24 * 24]);
    assert_eq!(view.target_opacity, 0.475);
    assert_eq!(view.holder_opacity, 0.);
}

#[test]
fn snapshots_and_repeated_toggles_keep_previous_image_in_base() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2, 64]);
    assert_eq!(map.view().toggles, [0, 0, 0, 1]);
    assert_eq!(pixel(map.view().base_rgba, 3), [255; 4]);
    apply(&mut map, &[b'V', 64]);
    assert_eq!(map.view().toggles, [0; 4]);
    assert_eq!(pixel(map.view().base_rgba, 3), [255; 4]);
    assert_eq!(pixel(map.view().alternate_rgba, 3), [0; 4]);
    apply(&mut map, &[b'V', 64]);
    assert_eq!(pixel(map.view().base_rgba, 3), [0; 4]);
    assert_eq!(pixel(map.view().alternate_rgba, 3), [255; 4]);
    apply(&mut map, &[b'M', 0, 2]);
    assert_eq!(map.view().toggles, [0; 4]);
    assert_eq!(pixel(map.view().base_rgba, 3), [255; 4]);
}

#[test]
fn repeated_upper_u_keeps_stale_base_and_independent_toggle_history() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2, 64]);
    apply(&mut map, &[b'U', 0, 2, 32]);
    assert_eq!(pixel(map.view().base_rgba, 3), [255; 4]);
    assert_eq!(pixel(map.view().alternate_rgba, 2), [255; 4]);
    assert_eq!(map.view().toggles, [0, 0, 0, 1]);
    apply(&mut map, &[b'U', 0, 2, 16]);
    assert_eq!(pixel(map.view().base_rgba, 3), [255; 4]);
    assert_eq!(pixel(map.view().alternate_rgba, 1), [255; 4]);
    apply(&mut map, &[b'V', 64]);
    assert_eq!(map.view().toggles, [0; 4]);
    assert_eq!(pixel(map.view().alternate_rgba, 3), [0; 4]);
    assert_eq!(pixel(map.view().alternate_rgba, 1), [255; 4]);
}

#[test]
fn fresh_upper_and_empty_layered_replacements_enter_normally() {
    let mut map = map();
    apply(&mut map, &[b'U', 0, 2, 64]);
    assert!(map.view().entering);
    assert_eq!(map.view().base_rgba, map.view().alternate_rgba);
    assert_eq!(map.view().toggles, [0; 4]);
    apply(&mut map, &[b'L', 0, 0, 2, 255]);
    assert_eq!(pixel(map.view().base_rgba, 3), [255; 4]);
    assert_eq!(map.view().alternate_rgba, [0; 16]);
    assert_eq!(map.view().transition, 0.);
}

#[test]
fn legacy_u_preserves_same_size_alternate_toggles_transition_and_alphas() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 80, 64]);
    map.advance(input(8., 1.), None).unwrap();
    let before = map.clone();
    apply(&mut map, &[b'u', 64]);
    let view = map.view();
    assert_eq!(view.toggles, before.view().toggles);
    assert_eq!(view.alternate_rgba, before.view().alternate_rgba);
    assert_eq!(view.transition, before.view().transition);
    assert_eq!(view.base_opacity, before.view().base_opacity);
    assert_eq!(view.alternate_opacity, before.view().alternate_opacity);
    assert_eq!(pixel(view.base_rgba, 0), [255; 4]);
    assert_eq!(pixel(view.base_rgba, 6399), [0; 4]);
    apply(&mut map, &[b'V', 64]);
    assert_eq!(map.view().toggles[6399], 0);
    assert_eq!(pixel(map.view().alternate_rgba, 6399), [0; 4]);
    assert_eq!(pixel(map.view().base_rgba, 6399), [255; 4]);
}

#[test]
fn legacy_resize_and_m_u_v_do_not_mix_binary_and_visual_planes() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2, 64]);
    apply(&mut map, &[b'u', 64]);
    assert_eq!(map.view().dimension, Some(80));
    assert!(map.view().toggles.iter().all(|&v| v == 0));
    assert!(map.view().alternate_rgba.iter().all(|&v| v == 0));
    apply(&mut map, &[b'V', 64]);
    assert_eq!(map.view().toggles[6399], 1);
    assert_eq!(pixel(map.view().alternate_rgba, 6399), [255; 4]);
    assert_eq!(pixel(map.view().base_rgba, 0), [0; 4]);
}

#[test]
fn layered_colors_and_effective_lighter_persist_until_resize() {
    let mut map = map();
    apply(&mut map, &[b'L', 3, 0, 1, 64, 64, 64]);
    assert_eq!(pixel(map.view().alternate_rgba, 0), [153, 170, 255, 255]);
    assert_eq!(map.view().composite, MinimapComposite::SourceOver);
    apply(&mut map, &[b'L', 2, 0, 1, 64, 64]);
    assert_eq!(pixel(map.view().alternate_rgba, 0), [255; 4]);
    assert_eq!(map.view().composite, MinimapComposite::Lighter);
    apply(&mut map, &[b'L', 3, 0, 1, 64, 64, 64]);
    assert_eq!(pixel(map.view().alternate_rgba, 0), [255; 4]);
    apply(&mut map, &[b'L', 2, 0, 2, 64, 32]);
    assert_eq!(pixel(map.view().alternate_rgba, 3), [255, 128, 128, 255]);
    assert_eq!(pixel(map.view().alternate_rgba, 2), [153, 170, 255, 255]);
    apply(&mut map, &[b'V', 32]);
    assert_eq!(pixel(map.view().base_rgba, 2), [153, 170, 255, 255]);
    assert_eq!(pixel(map.view().alternate_rgba, 2), [255; 4]);
    for command in [
        &b"U\x00\x02"[..],
        &b"M\x00\x02"[..],
        &b"V"[..],
        &b"L\x00\x00\x02"[..],
    ] {
        apply(&mut map, command);
        assert_eq!(map.view().composite, MinimapComposite::Lighter);
    }
    apply(&mut map, &[b'L', 3, 0, 1, 64, 64, 64]);
    assert_eq!(map.view().composite, MinimapComposite::SourceOver);
    assert_eq!(pixel(map.view().alternate_rgba, 0), [153, 170, 255, 255]);
}

#[test]
fn reachable_v_error_preserves_all_native_state_and_zero_size_ignores_it() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 3, 64]);
    map.advance(input(8., 1.), None).unwrap();
    let before = map.clone();
    let packet = parse_minimap(&[b'V', 64, 255]).unwrap();
    assert_eq!(
        map.apply_packet(packet),
        Err(MinimapError::Decode(
            MinimapDecodeError::TruncatedRunOperand
        ))
    );
    assert_eq!(map, before);
    apply(&mut map, &[b'M', 0, 0, 255]);
    apply(&mut map, &[b'V', 255]);
    assert_eq!(map.view().dimension, Some(0));
    assert!(map.view().base_rgba.is_empty());
}

#[test]
fn maximum_and_capped_sizes_short_and_saturated_payloads() {
    let mut map = map();
    for size in [512_u16, 513, u16::MAX] {
        let [hi, lo] = size.to_be_bytes();
        apply(&mut map, &[b'M', hi, lo, 64]);
        assert_eq!(map.view().dimension, Some(512));
        assert_eq!(map.view().base_rgba.len(), 4 * 512 * 512);
        assert_eq!(map.view().alternate_rgba.len(), 4 * 512 * 512);
        assert_eq!(map.view().toggles.len(), 512 * 512);
        assert_eq!(pixel(map.view().alternate_rgba, 512 * 512 - 1), [255; 4]);
    }
    apply(&mut map, &[b'M', 0, 3, 255, 255, 255]);
    assert!(map.view().toggles.iter().all(|&v| v == 0));
    assert_eq!(map.view().radius, Some(1.5));
}

#[test]
fn fade_uses_callback_count_transition_uses_shared_lagged_delta() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2, 64]);
    map.advance(input(0., 0.), None).unwrap();
    assert_eq!(map.view().fade, 0.025);
    assert_eq!(map.view().transition, 0.);
    assert_eq!(map.view().base_opacity, 0.475);
    assert_eq!(map.view().alternate_opacity, 0.);
    map.observe_ui_fraction(0.5).unwrap();
    assert_eq!(map.view().holder_opacity, 0.0125);
    let mut clock = FrameClock::new(0.).unwrap();
    let mut update = input(40., 0.);
    update.step = clock.advance(40., true, false).unwrap();
    map.advance(update, None).unwrap();
    let transition = update.step.delta / 230.;
    assert_eq!(map.view().transition.to_bits(), transition.to_bits());
    assert_eq!(
        map.view().base_opacity.to_bits(),
        (0.475 * (1. - transition)).to_bits()
    );
    let alternate = 1. - (1. - 0.475) / (1. - 0.475 * (1. - transition));
    assert_eq!(map.view().alternate_opacity.to_bits(), alternate.to_bits());
    assert_eq!(map.view().holder_opacity, 0.05);
    map.observe_ui_fraction(-2.).unwrap();
    assert_eq!(map.view().holder_opacity, -0.1);
    let mut disconnected = input(48., 1.);
    disconnected.connected = false;
    let before = map.clone();
    map.advance(disconnected, None).unwrap();
    assert_eq!(map, before);
}

#[test]
fn completed_fade_does_not_overwrite_later_ui_fraction_and_transition_stops() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2, 64]);
    for i in 0..60 {
        map.advance(input(f64::from(i) * 40., 5.), None).unwrap();
    }
    assert_eq!(map.view().fade, 1.);
    assert_eq!(map.view().transition, 1.);
    assert_eq!(map.view().base_opacity, 0.);
    assert_eq!(map.view().alternate_opacity, 0.475);
    map.observe_ui_fraction(0.25).unwrap();
    let before = map.clone();
    map.advance(input(3000., 0.), None).unwrap();
    assert_eq!(map, before);
}

#[test]
fn marker_strict_due_gate_uses_fresh_sample_and_survives_disconnection() {
    let mut map = map();
    let mut update = input(150., 0.);
    update.own_raw_head = Some(Point { x: 1000., y: 1900. });
    assert!(!map.marker_refresh_due(update));
    map.advance(update, None).unwrap();
    assert_eq!(map.view().marker, Point::default());
    update.now_ms = 151.;
    update.connected = false;
    assert!(map.marker_refresh_due(update));
    map.advance(update, Some(153.)).unwrap();
    assert_eq!(map.view().last_marker_ms, 153.);
    assert_eq!(map.view().marker, Point { x: 17., y: 29. });
    assert_eq!(map.view().fade, 0.);
    update.now_ms = 303.;
    assert!(!map.marker_refresh_due(update));
    update.now_ms = 304.;
    update.displayed_radius = Some(450.);
    map.advance(update, Some(305.)).unwrap();
    assert_eq!(map.view().marker, Point { x: 17., y: 41. });
    update.now_ms = 10000.;
    update.own_raw_head = None;
    map.advance(update, None).unwrap();
    assert_eq!(map.view().last_marker_ms, 305.);
    assert_eq!(map.view().marker, Point { x: 17., y: 41. });
}

#[test]
fn marker_projection_keeps_js_negative_ties_and_signed_zero() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2]);
    let mut update = input(200., 0.);
    update.center = Some(0.);
    update.displayed_radius = Some(1.);
    update.own_raw_head = Some(Point {
        x: -6.03125,
        y: -6.25,
    });
    map.advance(update, Some(201.)).unwrap();
    assert_eq!(map.view().marker.x.to_bits(), (-0_f64).to_bits());
    assert_eq!(map.view().marker.y, -0.2);
    update.now_ms = 400.;
    update.own_raw_head = Some(Point {
        x: (-6.25_f64).next_down(),
        y: 123456.,
    });
    map.advance(update, Some(401.)).unwrap();
    assert_eq!(map.view().marker.x, -0.3);
    assert!(map.view().marker.y > 512.); // No inferred arena clipping.
}

#[test]
fn invalid_used_numbers_and_missing_fresh_sample_preserve_state() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 2, 64]);
    let before = map.clone();
    for delta in [f64::NAN, -1., 5.01, f64::INFINITY] {
        assert_eq!(
            map.advance(input(200., delta), None),
            Err(MinimapError::InvalidNumericInput)
        );
        assert_eq!(map, before);
    }
    let mut update = input(200., 1.);
    update.own_raw_head = Some(Point { x: 1000., y: 1000. });
    for sample in [None, Some(f64::NAN), Some(f64::INFINITY)] {
        assert_eq!(
            map.advance(update, sample),
            Err(MinimapError::InvalidNumericInput)
        );
        assert_eq!(map, before);
    }
    for radius in [None, Some(0.), Some(f64::NAN)] {
        update.displayed_radius = radius;
        assert_eq!(
            map.advance(update, Some(201.)),
            Err(MinimapError::InvalidNumericInput)
        );
        assert_eq!(map, before);
    }
    assert_eq!(
        map.observe_ui_fraction(f64::NAN),
        Err(MinimapError::InvalidNumericInput)
    );
    assert_eq!(map, before);
    update.now_ms = 100.; // Geometry is unused before the strict marker gate.
    map.advance(update, None).unwrap();
}

#[test]
fn setup_and_world_reset_have_distinct_retention_and_opacity_writes() {
    let mut map = map();
    apply(&mut map, &[b'L', 2, 0, 24, 64]);
    apply(&mut map, &[b'V', 64]);
    let mut update = input(200., 1.);
    update.own_raw_head = Some(Point { x: 1000., y: 1000. });
    map.advance(update, Some(202.)).unwrap();
    map.observe_ui_fraction(0.5).unwrap();
    let before = map.clone();
    map.reset_world();
    let view = map.view();
    assert!(!view.has_setup);
    assert!(!view.entering);
    assert_eq!(view.fade, 0.);
    assert_eq!(view.dimension, before.view().dimension);
    assert_eq!(view.toggles, before.view().toggles);
    assert_eq!(view.composite, MinimapComposite::Lighter);
    assert_eq!(view.transition, before.view().transition);
    assert_eq!(view.marker, before.view().marker);
    assert_eq!(view.last_marker_ms, 202.);
    assert_eq!(view.holder_opacity, before.view().holder_opacity);
    assert!(view.base_rgba.iter().all(|&v| v == 0));
    assert!(view.alternate_rgba.iter().all(|&v| v == 0));
    assert_eq!(
        map.apply_packet(parse_minimap(b"V").unwrap()),
        Err(MinimapError::MissingSetup)
    );
    map.apply_setup(&setup()).unwrap();
    assert_eq!(map.view().composite, MinimapComposite::SourceOver);
    assert!(map.view().toggles.iter().all(|&v| v == 0));
    assert_eq!(map.view().transition, before.view().transition);
    assert_eq!(map.view().holder_opacity, 0.);
    apply(&mut map, &[b'M', 0, 24, 64]);
    map.advance(input(210., 1.), None).unwrap();
    let progress = map.view().transition;
    let fade = map.view().fade;
    map.apply_setup(&setup()).unwrap(); // Same-size Setup still forces clearing.
    assert!(map.view().base_rgba.iter().all(|&v| v == 0));
    assert!(map.view().alternate_rgba.iter().all(|&v| v == 0));
    assert!(map.view().toggles.iter().all(|&v| v == 0));
    assert!(map.view().entering);
    assert_eq!(map.view().transition, progress);
    assert_eq!(map.view().fade, fade);
    assert_eq!(map.view().holder_opacity, 0.);
}

#[test]
fn layout_exposes_independent_layers_background_marker_and_plain_label() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 3, 64]);
    map.advance(input(8., 1.), None).unwrap();
    let widget = plan_minimap(
        map.view(),
        MinimapLayout {
            right_ui_inset: 3.,
            bottom_ui_offset: 4.,
        },
    )
    .unwrap()
    .widget
    .unwrap();
    assert_eq!(widget.side, 27.);
    assert_eq!(widget.right_bottom, Point { x: 19., y: 20. });
    assert_eq!(widget.z_index, 10);
    assert_eq!(widget.opacity, map.view().holder_opacity);
    assert_eq!(widget.background.radius, 1.5);
    assert_eq!(widget.background.center, Point { x: 13.5, y: 13.5 });
    assert_eq!(widget.background.fill, [32, 38, 48]);
    assert_eq!(widget.background.quadrant_fill, [64, 70, 80]);
    assert_eq!(widget.background.opacity, 0.45);
    assert_eq!(widget.background.z_index, 11);
    assert_eq!(widget.background.shadow_blur, 12.);
    assert_eq!(widget.images[0].z_index, 12);
    assert_eq!(widget.images[1].z_index, 13);
    assert_eq!(widget.images[0].top_left, Point { x: 12., y: 12. });
    assert_eq!(widget.images[0].opacity, map.view().base_opacity);
    assert_eq!(widget.images[1].opacity, map.view().alternate_opacity);
    assert_eq!(
        widget.images[0].rgba.as_ptr(),
        map.view().base_rgba.as_ptr()
    );
    assert_eq!(
        widget.images[1].rgba.as_ptr(),
        map.view().alternate_rgba.as_ptr()
    );
    assert_eq!(widget.marker.z_index, 13);
    assert_eq!(widget.marker.top_left, Point::default());
    assert_eq!(widget.marker.side, 14.);
    assert_eq!(widget.marker.radius, 2.5);
    assert_eq!(widget.marker.stroke_width, 2.);
    assert_eq!(widget.marker.opacity, 1.);
    assert_eq!(widget.label.text, "server 42");
    assert_eq!(widget.label.top_left.y, 20.);
    assert_eq!(widget.label.size, Point { x: 27., y: 37. });
    assert_eq!(widget.label.font_size, 14.);
    assert_eq!(widget.label.opacity, 0.5);
    assert_eq!(widget.label.shadow_blur, 8.);
}

#[test]
fn zero_size_has_empty_images_team_and_zero_server_have_no_label() {
    let mut map = map();
    apply(&mut map, &[b'M', 0, 0, 255]);
    let widget = plan_minimap(map.view(), MinimapLayout::default())
        .unwrap()
        .widget
        .unwrap();
    assert_eq!(widget.side, 24.);
    assert_eq!(widget.background.radius, 0.);
    assert_eq!(widget.images[0].dimension, 0);
    assert!(widget.images.iter().all(|image| image.rgba.is_empty()));
    let mut metadata = setup();
    metadata.game_mode = Some(2);
    map.apply_setup(&metadata).unwrap();
    assert_eq!(map.view().target_opacity, 0.7);
    assert!(
        plan_minimap(map.view(), MinimapLayout::default())
            .unwrap()
            .widget
            .unwrap()
            .label
            .text
            .is_empty()
    );
    metadata.game_mode = Some(0);
    metadata.server_number = Some(0);
    map.apply_setup(&metadata).unwrap();
    assert!(
        plan_minimap(map.view(), MinimapLayout::default())
            .unwrap()
            .widget
            .unwrap()
            .label
            .text
            .is_empty()
    );
}

#[test]
fn layout_and_borrowed_view_validation_do_not_mutate_state() {
    let map = map();
    let before = map.clone();
    for offset in [-1., f64::NAN, f64::INFINITY] {
        assert_eq!(
            plan_minimap(
                map.view(),
                MinimapLayout {
                    right_ui_inset: offset,
                    bottom_ui_offset: 0.
                }
            ),
            Err(MinimapError::InvalidLayout)
        );
        assert_eq!(
            plan_minimap(
                map.view(),
                MinimapLayout {
                    right_ui_inset: 0.,
                    bottom_ui_offset: offset
                }
            ),
            Err(MinimapError::InvalidLayout)
        );
    }
    let mut view = map.view();
    view.base_rgba = &[];
    assert_eq!(
        plan_minimap(view, MinimapLayout::default()),
        Err(MinimapError::InvalidRenderPlan)
    );
    let mut view = map.view();
    view.marker.x = f64::NAN;
    assert_eq!(
        plan_minimap(view, MinimapLayout::default()),
        Err(MinimapError::InvalidRenderPlan)
    );
    assert_eq!(map, before);
}
