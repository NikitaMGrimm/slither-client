//! Original synthetic paired-face geometry and appearance ownership checks.

use slither_client::{
    presentation::{
        AnimatedClient, ClientPresentationError, EyeLayoutInput, PairedFaceGeometry,
        PairedSideGeometry, StandardEyeGeometry,
    },
    protocol::ElapsedHeader,
    state::Point,
};

fn geometry() -> PairedSideGeometry {
    PairedSideGeometry {
        forward: 11.375,
        lateral: 3.125,
        lateral_bias: 0.375,
        rotation_offset: 0.287,
        image_scale: 0.3125,
        pivot_x: 9.25,
        pivot_y: -7.5,
        width: 47.,
        height: 31.,
    }
}

fn view() -> EyeLayoutInput {
    EyeLayoutInput {
        corrected_head: Point {
            x: 951.125,
            y: 1028.25,
        },
        camera: Point {
            x: 923.375,
            y: 1011.5,
        },
        viewport_half: Point { x: 480., y: 270. },
        scale: 1.2375,
        zoom: 0.7125,
        death_progress: 0.375,
    }
}

#[test]
fn ordered_layout_preserves_unfactored_oblique_geometry_and_independent_pivots() {
    let g = geometry();
    let v = view();
    let h = 0.713_f64;
    let layouts = g.layout(h, v).unwrap();
    for (i, side) in [-1., 1.].into_iter().enumerate() {
        let a = h + side * std::f64::consts::FRAC_PI_2;
        let x = (h.cos() * g.forward) * v.scale + a.cos() * (g.lateral * v.scale + g.lateral_bias);
        let y = (h.sin() * g.forward) * v.scale + a.sin() * (g.lateral * v.scale + g.lateral_bias);
        assert_eq!(
            layouts[i].translation.x.to_bits(),
            (v.viewport_half.x + ((x + v.corrected_head.x) - v.camera.x) * v.zoom).to_bits()
        );
        assert_eq!(
            layouts[i].translation.y.to_bits(),
            (v.viewport_half.y + ((y + v.corrected_head.y) - v.camera.y) * v.zoom).to_bits()
        );
        assert_eq!(
            layouts[i].rotation.to_bits(),
            (h + side * g.rotation_offset).to_bits()
        );
        let m = (v.scale * v.zoom) * g.image_scale;
        assert_eq!(
            layouts[i].destination.x.to_bits(),
            (-g.pivot_x * m).to_bits()
        );
        assert_eq!(
            layouts[i].destination.y.to_bits(),
            (-g.pivot_y * m).to_bits()
        );
        assert_eq!(
            layouts[i].destination.width.to_bits(),
            (g.width * m).to_bits()
        );
        assert_eq!(
            layouts[i].destination.height.to_bits(),
            (g.height * m).to_bits()
        );
    }
    let mut live = v;
    live.death_progress = 0.;
    assert_eq!(
        g.layout(h, live).unwrap(),
        layouts,
        "decoration geometry does not fade with death"
    );
}

#[test]
fn every_field_has_bounded_validation_and_bitwise_coherence() {
    fn access(g: &mut PairedSideGeometry, index: usize) -> &mut f64 {
        match index {
            0 => &mut g.forward,
            1 => &mut g.lateral,
            2 => &mut g.lateral_bias,
            3 => &mut g.rotation_offset,
            4 => &mut g.image_scale,
            5 => &mut g.pivot_x,
            6 => &mut g.pivot_y,
            7 => &mut g.width,
            _ => &mut g.height,
        }
    }
    for index in 0..9 {
        for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, 65536.] {
            let mut g = geometry();
            *access(&mut g, index) = invalid;
            assert!(g.validate().is_err());
        }
        let mut negative = geometry();
        *access(&mut negative, index) = -0.;
        if [4, 7, 8].contains(&index) {
            assert!(negative.validate().is_err());
        } else {
            negative.validate().unwrap();
            let mut positive = negative;
            *access(&mut positive, index) = 0.;
            assert!(!negative.same_bits(&positive));
            assert!(negative.same_bits(&negative));
        }
    }
}

#[test]
fn derived_signed_zeros_underflow_and_late_overflow_are_not_normalized() {
    let mut g = geometry();
    g.pivot_x = 0.;
    g.pivot_y = -0.;
    let mut v = view();
    v.scale = f64::from_bits(1);
    v.zoom = 0.05;
    let pair = g.layout(-0., v).unwrap();
    assert_eq!(pair[0].destination.x.to_bits(), (-0_f64).to_bits());
    assert_eq!(pair[0].destination.y.to_bits(), 0_f64.to_bits());
    assert_eq!(pair[0].destination.width, 0.);
    v.scale = f64::MAX;
    assert!(g.layout(0., v).is_err());
    v = view();
    v.corrected_head.x = f64::MAX;
    v.zoom = 8.;
    assert!(g.layout(0., v).is_err());
}

fn u24(v: u32) -> [u8; 3] {
    let b = v.to_be_bytes();
    [b[1], b[2], b[3]]
}
fn setup() -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for n in [430_u16, 100, 20] {
        p.extend(n.to_be_bytes());
    }
    p.push(48);
    for n in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(n.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}
fn appearance() -> Vec<u8> {
    let mut p = vec![b's', 0, 7];
    p.extend(u24(2_000_000));
    p.push(b'0');
    p.extend(u24(4_000_000));
    p.extend([0, 0]);
    p.extend(u24(0));
    p.push(0);
    p.extend(u24(10000));
    p.extend(u24(5000));
    p.extend([0, 0, 255]);
    p.extend(u24(9790));
    p.extend(u24(5000));
    p
}
fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut frame = vec![];
    for p in commands {
        frame.extend((p.len() as u16).to_be_bytes());
        frame.extend(p);
    }
    frame
}
fn style(g: Option<PairedSideGeometry>) -> PairedFaceGeometry {
    PairedFaceGeometry {
        eyes: StandardEyeGeometry {
            pupil_travel: 0.02,
            ..StandardEyeGeometry::default()
        },
        decoration: g,
    }
}
fn apply(client: &mut AnimatedClient, packets: &[Vec<u8>]) {
    client
        .apply_frame(&bundle(packets), ElapsedHeader::Absent)
        .unwrap();
}

#[test]
fn face_ownership_survives_duplicate_death_reuse_and_short_preparation() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let mut ordinal = 0;
    let mut signed = geometry();
    signed.pivot_x = -0.;
    let styles = [style(Some(signed)), style(None), style(Some(geometry()))];
    c.apply_frame_with_face_geometry::<ClientPresentationError, _>(
        &bundle(&[
            setup(),
            appearance(),
            appearance(),
            vec![b's', 0, 7, 1],
            appearance(),
        ]),
        ElapsedHeader::Absent,
        |_| {
            let s = styles[ordinal];
            ordinal += 1;
            Ok(s)
        },
    )
    .unwrap();
    assert_eq!(ordinal, 3);
    assert_eq!(
        c.own_snake()
            .unwrap()
            .face_geometry()
            .unwrap()
            .decoration
            .unwrap()
            .pivot_x
            .to_bits(),
        (-0_f64).to_bits()
    );
    assert!(!c.own_snake().unwrap().metrics().alive);
    c.advance(4., false).unwrap();
    let faces = c.prepare_draw_with_style(960, 540, 1., false).unwrap();
    assert_eq!(faces.len(), 3);
    assert!(faces.iter().all(|s| s.curve.is_none()));
    assert_eq!(
        faces.iter().map(|s| s.own).collect::<Vec<_>>(),
        [true, false, false]
    );
    assert!(faces[1].face_decoration.is_none());
    assert_eq!(faces[2].face_decoration, Some(geometry()));
    apply(&mut c, &[vec![b's', 0, 7, 0]]);
    let remaining = c.prepare_draw_with_style(960, 540, 1., false).unwrap();
    assert_eq!(remaining.len(), 2);
    assert!(
        remaining[0].own,
        "a death already detached the own object's wire identity"
    );
    apply(&mut c, &[vec![b's', 0, 7, 0]]);
    assert_eq!(
        c.prepare_draw_with_style(960, 540, 1., false)
            .unwrap()
            .len(),
        1
    );
    assert!(
        c.own_snake()
            .unwrap()
            .face_geometry()
            .unwrap()
            .decoration
            .unwrap()
            .same_bits(&signed)
    );
}

#[test]
fn late_invalid_face_and_malformed_packets_roll_back_the_entire_client() {
    let mut c = AnimatedClient::new(0.).unwrap();
    apply(&mut c, &[setup(), appearance()]);
    c.advance(4., false).unwrap();
    c.prepare_draw(960, 540).unwrap();
    let before = c.clone();
    let mut calls = 0;
    assert!(
        c.apply_frame_with_face_geometry::<ClientPresentationError, _>(
            &bundle(&[appearance(), appearance()]),
            ElapsedHeader::Absent,
            |_| {
                calls += 1;
                let mut g = geometry();
                if calls == 2 {
                    g.image_scale = 0.;
                }
                Ok(style(Some(g)))
            }
        )
        .is_err()
    );
    assert_eq!(calls, 2);
    assert_eq!(c, before);
    calls = 0;
    assert!(
        c.apply_frame_with_face_geometry::<ClientPresentationError, _>(
            &bundle(&[appearance(), vec![b'r', 0]]),
            ElapsedHeader::Absent,
            |_| {
                calls += 1;
                Ok(style(Some(geometry())))
            }
        )
        .is_err()
    );
    assert_eq!(calls, 0);
    assert_eq!(c, before);
    c.apply_frame_with_face_geometry::<ClientPresentationError, _>(
        &bundle(&[appearance(), vec![b's', 0, 7, 0], setup(), appearance()]),
        ElapsedHeader::Absent,
        |_| {
            calls += 1;
            Ok(style(Some(geometry())))
        },
    )
    .unwrap();
    assert_eq!(calls, 2);
}

#[test]
fn explicit_default_face_and_legacy_apis_share_all_numeric_transitions() {
    let mut legacy = AnimatedClient::new(0.).unwrap();
    let mut explicit = legacy.clone();
    let frame = bundle(&[setup(), appearance()]);
    legacy.apply_frame(&frame, ElapsedHeader::Absent).unwrap();
    explicit
        .apply_frame_with_face_geometry::<ClientPresentationError, _>(
            &frame,
            ElapsedHeader::Absent,
            |_| Ok(PairedFaceGeometry::default()),
        )
        .unwrap();
    for t in [4., 32., 72.] {
        legacy.advance(t, false).unwrap();
        explicit.advance(t, false).unwrap();
        assert_eq!(
            legacy.prepare_draw_with_style(960, 540, 1., false).unwrap(),
            explicit
                .prepare_draw_with_style(960, 540, 1., false)
                .unwrap()
        );
        assert_eq!(legacy, explicit);
    }
}
