//! Authored menu selections and native plans, with no browser, sources or sessions.
use slither_client::{
    appearance_preview::{
        AppearancePreview, MAX_PREVIEW_SAMPLES, PreviewAvailability, PreviewFace,
    },
    presentation::{FaceGeometry, resolve_authored_local_skin, resolve_skin},
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
        (3, vec![]),
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
