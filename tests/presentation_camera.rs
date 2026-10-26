//! Original synthetic camera inputs, without network or external references.

use slither_client::{
    presentation::{FollowCamera, INITIAL_ZOOM},
    state::Point,
};

#[test]
fn own_anchor_uses_displayed_head_and_draw_samples_after_packet() {
    let mut camera = FollowCamera::new(Point { x: 1000., y: 500. }, INITIAL_ZOOM).unwrap();
    camera
        .reanchor(Point { x: 1020., y: 510. }, Point { x: 1050., y: 520. })
        .unwrap();
    assert_eq!(camera.position(), Point { x: 1050., y: 520. });
    assert_eq!(camera.corrections().offset(), Point::default());
    camera
        .prepare_draw(Point { x: 1052., y: 521. }, 12)
        .unwrap();
    assert_eq!(camera.corrections().offset(), Point { x: -30., y: -10. });
    assert_eq!(camera.position(), Point { x: 1022., y: 511. });
    assert_eq!(camera.corrections().pending(), 61);
    assert_eq!(camera.zoom(), 0.64285 + 0.514285714);
}

#[test]
fn follow_off_still_schedules_and_consumes_camera_samples() {
    let mut camera = FollowCamera::new(Point { x: 1000., y: 500. }, INITIAL_ZOOM).unwrap();
    camera.set_follows(false);
    camera
        .reanchor(Point { x: 1020., y: 510. }, Point { x: 1050., y: 520. })
        .unwrap();
    assert_eq!(camera.position(), Point { x: 1000., y: 500. });
    camera
        .prepare_draw(Point { x: 1052., y: 521. }, 12)
        .unwrap();
    assert_eq!(camera.position(), Point { x: 1000., y: 500. });
    assert_eq!(camera.corrections().offset(), Point { x: 20., y: 10. });
    assert_eq!(camera.corrections().pending(), 61);
    camera.set_follows(true);
    camera
        .prepare_draw(Point { x: 1052., y: 521. }, 12)
        .unwrap();
    let offset = camera.corrections().offset();
    assert_eq!(
        camera.position(),
        Point {
            x: 1052. + offset.x,
            y: 521. + offset.y
        }
    );
    assert_eq!(camera.corrections().pending(), 60);
}

#[test]
fn automatic_zoom_uses_draw_count_and_clamps_at_target() {
    let mut camera = FollowCamera::new(Point::default(), 2.).unwrap();
    camera.prepare_draw(Point::default(), 12).unwrap();
    assert_eq!(camera.zoom(), 2. - 0.0002);
    camera.prepare_draw(Point::default(), 12).unwrap();
    assert_eq!(camera.zoom(), 2. - 0.0002 - 0.0002);
    let target = 0.64285 + 0.514285714;
    camera.set_zoom(target - 0.00001).unwrap();
    camera.prepare_draw(Point::default(), 12).unwrap();
    assert_eq!(camera.zoom(), target);
    camera.set_zoom(target + 0.00001).unwrap();
    camera.prepare_draw(Point::default(), 12).unwrap();
    assert_eq!(camera.zoom(), target);
    camera.prepare_draw(Point::default(), 12).unwrap();
    assert_eq!(camera.zoom(), target);
}

#[test]
fn invalid_inputs_and_late_draw_overflow_preserve_all_camera_state() {
    let mut camera = FollowCamera::default();
    for zoom in [0., -1., f64::NAN, f64::INFINITY] {
        let before = camera.clone();
        assert!(camera.set_zoom(zoom).is_err());
        assert_eq!(camera, before);
    }
    assert!(FollowCamera::new(Point { x: f64::NAN, y: 0. }, 1.).is_err());
    let before = camera.clone();
    assert!(
        camera
            .set_position(Point {
                x: 0.,
                y: f64::INFINITY
            })
            .is_err()
    );
    assert_eq!(camera, before);
    camera
        .reanchor(
            Point {
                x: -f64::MAX,
                y: 0.,
            },
            Point::default(),
        )
        .unwrap();
    let before = camera.clone();
    assert!(
        camera
            .prepare_draw(
                Point {
                    x: -f64::MAX,
                    y: 0.
                },
                12
            )
            .is_err()
    );
    assert_eq!(camera, before, "failed draw must not consume a correction");
    assert!(
        camera
            .reanchor(
                Point {
                    x: -f64::MAX,
                    y: 0.
                },
                Point { x: f64::MAX, y: 0. }
            )
            .is_err()
    );
    assert_eq!(camera, before);
}
