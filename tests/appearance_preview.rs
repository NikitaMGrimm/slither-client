//! Authored menu selections and native plans, with no browser, sources or sessions.
use slither_client::{
    appearance_preview::{
        AppearancePreview, MAX_PREVIEW_SAMPLES, PreviewAvailability, PreviewFace,
    },
    presentation::{
        EyeLayoutInput, FaceGeometry, StaticHeadAccessoryGeometry, resolve_authored_local_skin,
        resolve_skin, stock_accessory_forward,
    },
    state::Point,
};

#[test]
fn selection_tickets_are_native_copied_and_only_change_with_appearance() {
    let mut preview = AppearancePreview::new(true);
    assert_eq!(preview.revision(), 0);
    assert!(!preview.needs_draw(0));
    let first = preview.select(0, &[]).unwrap();
    assert_eq!(first, 1);
    assert_eq!(preview.select(0, &[]).unwrap(), first);
    assert!(preview.needs_draw(first));
    preview.mark_drawn(first).unwrap();
    assert!(!preview.needs_draw(first));
    let next = preview.select(1, &[]).unwrap();
    assert_eq!(next, first + 1);
    assert!(!preview.needs_draw(first));
    assert!(preview.mark_drawn(first).is_err());
    assert!(preview.needs_draw(next));
    let mut bytes = vec![0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2];
    preview.select(1, &bytes).unwrap();
    bytes[9] = 1;
    assert_eq!(preview.custom()[9], 0);
}

#[test]
fn invalid_selection_preserves_last_valid_revision_and_draw_commit() {
    let mut preview = AppearancePreview::new(true);
    let revision = preview.select(2, &[]).unwrap();
    preview.mark_drawn(revision).unwrap();
    for (skin, custom) in [
        (66, vec![]),
        (0, vec![0; 256]),
        (0, vec![0; 9]),
        (0, vec![0, 0, 0, 0, 0, 0, 0, 0, 1, 3]),
    ] {
        assert!(preview.select(skin, &custom).is_err());
        assert_eq!(preview.skin(), 2);
        assert_eq!(preview.revision(), revision);
        assert!(!preview.needs_draw(revision));
    }
}

#[test]
fn local_family_and_custom_projection_is_the_existing_resolver() {
    let custom = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2];
    let mut preview = AppearancePreview::new(true);
    for skin in 0..3 {
        for bytes in [&[][..], custom.as_slice()] {
            preview.select(skin, bytes).unwrap();
            let plan = preview.plan(false).unwrap();
            assert_eq!(
                plan.descriptor,
                resolve_authored_local_skin(skin, bytes).unwrap()
            );
            assert!(matches!(
                plan.face,
                PreviewFace::Paired {
                    decoration: None,
                    ..
                }
            ));
            assert!(plan.antenna.is_none());
        }
    }
}

#[test]
fn all_stock_choices_use_existing_descriptor_and_selected_native_face_and_antenna() {
    let mut preview = AppearancePreview::new(false);
    for skin in 0..66 {
        preview.select(skin, &[]).unwrap();
        let plan = preview.plan(true).unwrap();
        let descriptor = resolve_skin(skin, &[], true).unwrap();
        assert_eq!(plan.descriptor, descriptor);
        match (descriptor.face, &plan.face) {
            (FaceGeometry::Paired(_), PreviewFace::Paired { .. })
            | (FaceGeometry::SingleImage(_), PreviewFace::SingleImage(_))
            | (FaceGeometry::Mouth(_), PreviewFace::Mouth(_)) => (),
            _ => panic!("preview face family changed"),
        }
        assert_eq!(plan.antenna.is_some(), descriptor.antenna.is_some());
        if let Some(antenna) = plan.antenna {
            assert!(antenna.bulb.is_some());
            assert!(!antenna.strokes.is_empty());
        }
        assert!((2..=MAX_PREVIEW_SAMPLES).contains(&plan.geometry.samples.len()));
        assert!(
            plan.geometry
                .samples
                .iter()
                .enumerate()
                .all(|(index, sample)| sample.ordinal == index
                    && sample.flag == 2
                    && sample.x.is_finite()
                    && sample.y.is_finite())
        );
    }
}

#[test]
fn run_and_color_edits_change_descriptor_without_unbounded_preview_geometry() {
    let mut preview = AppearancePreview::new(false);
    let first = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1];
    preview.select(24, &first).unwrap();
    let before = preview.plan(false).unwrap();
    let next = [0, 0, 0, 0, 0, 0, 0, 0, 255, 2, 255, 41];
    preview.select(24, &next).unwrap();
    let after = preview.plan(false).unwrap();
    assert_ne!(before.descriptor.runs, after.descriptor.runs);
    assert_eq!(before.geometry, after.geometry);
    assert!(after.antenna.is_none());
    assert!(after.descriptor.custom);
}

#[test]
fn static_pose_has_no_clock_and_planning_neither_commits_nor_mutates_selection() {
    let mut preview = AppearancePreview::new(false);
    assert!(preview.plan(false).is_err());
    let revision = preview.select(27, &[]).unwrap();
    let first = preview.plan(false).unwrap();
    assert_eq!(first, preview.plan(false).unwrap());
    assert_eq!(preview.revision(), revision);
    assert!(preview.needs_draw(revision));
    assert_eq!(first.visual.spawn, 1.);
    assert_eq!(first.visual.death, 0.);
    assert_eq!(first.visual.smoothed_speed, 0.);
}

#[test]
fn only_ready_source_projection_has_an_empty_status() {
    assert_eq!(PreviewAvailability::Ready.message(), "");
    assert!(!PreviewAvailability::Pending.message().is_empty());
    assert!(!PreviewAvailability::Unsupported.message().is_empty());
}

#[test]
fn current_own_context_is_stock_only_and_keeps_selected_face_eligibility() {
    let extent = Point { x: 48., y: 48. };
    let geometry = StaticHeadAccessoryGeometry {
        forward: 5.,
        image_scale: 0.375,
        pivot_x: -3.25,
        pivot_y: 7.5,
    };
    let mut local = AppearancePreview::new(true);
    assert!(!local.own_accessory_context());
    for skin in 0..3 {
        local.select(skin, &[]).unwrap();
        assert!(
            local
                .accessory_layout(&local.plan(false).unwrap(), geometry, extent)
                .is_err()
        );
    }
    let mut stock = AppearancePreview::new(false);
    assert!(stock.own_accessory_context());
    for skin in 0..66 {
        stock.select(skin, &[]).unwrap();
        let plan = stock.plan(false).unwrap();
        let actual = stock.accessory_layout(&plan, geometry, extent);
        assert_eq!(
            actual.is_ok(),
            !matches!(plan.descriptor.face, FaceGeometry::SingleImage(_))
        );
        assert!(
            stock.needs_draw(stock.revision()),
            "planning never commits a ticket"
        );
    }
    let custom = [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2];
    stock.select(27, &custom).unwrap();
    let plan = stock.plan(false).unwrap();
    assert!(plan.descriptor.custom);
    assert!(stock.accessory_layout(&plan, geometry, extent).is_ok());
}

#[test]
fn preview_accessory_reuses_exact_explicit_and_cached_forward_static_layout() {
    let mut preview = AppearancePreview::new(false);
    for (skin, custom) in [
        (0, &[][..]),
        (24, &[][..]),
        (40, &[][..]),
        (41, &[][..]),
        (27, &[0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 2][..]),
    ] {
        preview.select(skin, custom).unwrap();
        let plan = preview.plan(false).unwrap();
        let extent = Point { x: 48., y: 48. };
        for forward in [-0., stock_accessory_forward(skin, custom).unwrap()] {
            let geometry = StaticHeadAccessoryGeometry {
                forward,
                image_scale: 0.375,
                pivot_x: 0.,
                pivot_y: -0.,
            };
            let actual = preview.accessory_layout(&plan, geometry, extent).unwrap();
            let expected = geometry
                .layout(
                    0.,
                    extent,
                    1.,
                    EyeLayoutInput {
                        corrected_head: slither_client::appearance_preview::PREVIEW_HEAD,
                        camera: plan.view.camera,
                        viewport_half: Point { x: 160., y: 64. },
                        scale: 1.,
                        zoom: 1.,
                        death_progress: 0.,
                    },
                )
                .unwrap();
            assert_eq!(actual, expected);
            assert_eq!(actual.destination.x.to_bits(), (-0_f64).to_bits());
            assert_eq!(actual.destination.y.to_bits(), 0_f64.to_bits());
            assert_eq!(actual.destination.width, 18.);
            assert_eq!(actual.alpha, 1.);
            assert_eq!(
                preview.plan(false).unwrap(),
                plan,
                "accessory planning has no pose effects"
            );
        }
    }
}

#[test]
fn preview_accessory_rejects_invalid_extent_geometry_without_committing_draw() {
    let mut preview = AppearancePreview::new(false);
    let ticket = preview.select(0, &[]).unwrap();
    let plan = preview.plan(false).unwrap();
    let geometry = StaticHeadAccessoryGeometry {
        forward: 5.,
        image_scale: 0.25,
        pivot_x: 3.,
        pivot_y: 7.,
    };
    for extent in [
        Point { x: 0., y: 1. },
        Point { x: 1., y: f64::NAN },
        Point { x: 65536., y: 1. },
    ] {
        assert!(preview.accessory_layout(&plan, geometry, extent).is_err());
    }
    for geometry in [
        StaticHeadAccessoryGeometry {
            image_scale: 0.,
            ..geometry
        },
        StaticHeadAccessoryGeometry {
            forward: f64::INFINITY,
            ..geometry
        },
    ] {
        assert!(
            preview
                .accessory_layout(&plan, geometry, Point { x: 48., y: 48. })
                .is_err()
        );
    }
    assert_eq!(preview.revision(), ticket);
    assert!(preview.needs_draw(ticket));
}
