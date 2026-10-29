//! Original synthetic resource/lifetime witnesses; no catalog or native requests.
use slither_client::presentation::{AccessoryRequestInput, SelectedAccessoryRequest};

fn input() -> AccessoryRequestInput<'static> {
    AccessoryRequestInput {
        selection: Some("0"),
        count: 1,
        slot: 0,
        resource: "http://slither.io/s/a_zzz_000.png",
        image_scale: 1.,
        pivot_x: -0.,
        pivot_y: 2.,
    }
}
#[test]
fn one_attempt_load_publication_handoff_and_no_resurrection() {
    let mut owner = SelectedAccessoryRequest::new(10., 10010.).unwrap();
    assert_eq!(owner.prepare(input(), 10.).unwrap(), 2);
    let ticket = owner.ticket();
    owner
        .loaded(ticket, 20., true, [20., 12., 20., 12.])
        .unwrap();
    assert_eq!(owner.phase(), 4);
    owner.handoff(ticket, 21.).unwrap();
    owner.check(ticket, 20000.).unwrap();
    owner.dispose();
    assert!(!owner.live(ticket));
    assert!(
        owner
            .loaded(ticket, 20001., true, [20., 12., 20., 12.])
            .is_err()
    );
}
#[test]
fn no_selection_or_existing_image_never_requests() {
    for selected in [None, Some("-1")] {
        let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
        let mut value = input();
        value.selection = selected;
        value.count = 0;
        value.resource = "";
        assert_eq!(owner.prepare(value, 0.).unwrap(), 0);
        owner.check(owner.ticket(), 10001.).unwrap();
    }
    for slot in [1, 2] {
        let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
        let mut value = input();
        value.slot = slot;
        assert_eq!(owner.prepare(value, 0.).unwrap(), 1);
        owner.handoff(owner.ticket(), 1.).unwrap();
        owner.check(owner.ticket(), 10001.).unwrap();
    }
}
#[test]
fn url_shape_is_strict_but_not_catalog_authority() {
    assert!(SelectedAccessoryRequest::resource_valid(input().resource));
    for value in [
        "https://slither.io/s/a_zzz_000.png",
        "http://www.slither.io/s/a_zzz_000.png",
        "http://slither.io:80/s/a_zzz_000.png",
        "http://slither.io/s/a_zzz.png?q=1",
        "http://slither.io/s/a_zzz.png#x",
        "http://slither.io/s/a_../zzz.png",
        "http://slither.io/s/a_%7az.png",
        "http://slither.io/s/a_ZZZ.png",
        "http://slither.io/s/a_aa.png",
        "http://slither.io/s/a_abcdefghijkl.png",
    ] {
        assert!(!SelectedAccessoryRequest::resource_valid(value), "{value}");
    }
}
#[test]
fn malformed_prepare_and_repeat_attempt_are_terminal() {
    for mode in 0..5 {
        let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
        let mut value = input();
        match mode {
            0 => value.selection = Some("00"),
            1 => value.resource = "bad",
            2 => value.image_scale = 0.,
            3 => value.slot = 3,
            _ => value.count = 0,
        }
        assert!(owner.prepare(value, 0.).is_err());
        assert_eq!(owner.ticket(), 0);
        assert!(owner.prepare(input(), 1.).is_err());
    }
    let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
    owner.prepare(input(), 0.).unwrap();
    assert!(owner.prepare(input(), 1.).is_err());
    assert_eq!(owner.phase(), 6);
}
#[test]
fn dimensions_duplicate_event_deadline_and_generation_fail_closed() {
    for extents in [
        [0., 12., 0., 12.],
        [20., 12., 21., 12.],
        [20.5, 12., 20.5, 12.],
        [65536., 12., 65536., 12.],
    ] {
        let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
        owner.prepare(input(), 0.).unwrap();
        assert!(owner.loaded(owner.ticket(), 1., true, extents).is_err());
        assert_eq!(owner.phase(), 6);
    }
    for now in [10000., f64::NAN, -1.] {
        let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
        owner.prepare(input(), 0.).unwrap();
        assert!(owner.check(owner.ticket(), now).is_err());
        assert_eq!(owner.ticket(), 0);
    }
    let mut owner = SelectedAccessoryRequest::new(0., 10000.).unwrap();
    owner.prepare(input(), 0.).unwrap();
    owner
        .loaded(owner.ticket(), 1., true, [20., 12., 20., 12.])
        .unwrap();
    assert!(
        owner
            .loaded(owner.ticket(), 2., true, [20., 12., 20., 12.])
            .is_err()
    );
    assert!(SelectedAccessoryRequest::new(0., 0.).is_err());
}
