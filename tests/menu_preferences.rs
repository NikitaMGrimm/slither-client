//! Authored synthetic menu choices; no reference content, browser or server.
use slither_client::menu_preferences::{MAX_CUSTOM_RUNS, MAX_PREFERENCE_BYTES, MenuPreferences};

#[test]
fn defaults_validation_copy_and_reset_are_atomic() {
    let mut p = MenuPreferences::new(false);
    assert_eq!(p.view().skin, 0);
    assert!(p.view().custom_skin.is_empty());
    p.set_nickname(" \u{7f} ").unwrap();
    let mut bytes = vec![0; 8];
    bytes.extend_from_slice(&[2, 41, 1, 37]);
    p.select(65, &bytes).unwrap();
    bytes[8] = 0;
    assert_eq!(p.view().custom_skin[8], 2);
    let mut copied = p.view();
    copied.custom_skin[8] = 0;
    let prior = p.clone();
    for (skin, bytes) in [
        (66, vec![]),
        (0, vec![0; 256]),
        (0, vec![0; 9]),
        (0, vec![0; 10]),
        (0, [vec![0; 8], vec![1, 36]].concat()),
    ] {
        assert!(p.select(skin, &bytes).is_err());
        assert_eq!(p, prior);
    }
    for name in ["a".repeat(25), "é".into(), "\u{1f}".into()] {
        assert!(p.set_nickname(&name).is_err());
        assert_eq!(p, prior);
    }
    p.reset();
    assert_eq!(p, MenuPreferences::new(false));
}

#[test]
fn bounded_restore_roundtrips_and_rejects_whole_invalid_records() {
    let mut p = MenuPreferences::new(false);
    p.set_nickname("name: \u{7f}").unwrap();
    let bytes = [vec![0; 8], [255, 39].repeat(MAX_CUSTOM_RUNS)].concat();
    p.select(65, &bytes).unwrap();
    let saved = p.serialize();
    assert!(saved.len() <= MAX_PREFERENCE_BYTES);
    assert_eq!(MenuPreferences::restore(false, &saved), p);
    for saved in [
        "1:6e616d65:ff:",
        "2::00:",
        "1::0:",
        "1::00:xx",
        "1:ff:00:",
        "1::00::",
        "1::00:00000000000000000124",
    ] {
        assert_eq!(
            MenuPreferences::restore(false, saved),
            MenuPreferences::new(false)
        );
    }
    assert_eq!(
        MenuPreferences::restore(false, &"0".repeat(MAX_PREFERENCE_BYTES + 1)),
        MenuPreferences::new(false)
    );
    assert_eq!(
        MenuPreferences::restore(true, &saved),
        MenuPreferences::new(true)
    );
}

#[test]
fn native_actions_keep_stock_runs_and_local_family_bounds() {
    for local in [false, true] {
        let mut p = MenuPreferences::new(local);
        p.set_nickname("Saved").unwrap();
        p.action("previous-skin").unwrap();
        assert_eq!(p.view().skin, if local { 2 } else { 65 });
        p.action("next-skin").unwrap();
        assert_eq!(p.view().skin, 0);
        p.action("build").unwrap();
        p.action("next-color").unwrap();
        p.action("longer").unwrap();
        p.action("add-stripe").unwrap();
        assert_eq!(
            p.view().custom_skin,
            [vec![0; 8], vec![2, 1, 1, 1]].concat()
        );
        p.action("previous-color").unwrap();
        p.action("next-stripe").unwrap();
        p.action("remove-stripe").unwrap();
        assert_eq!(p.view().custom_skin.len(), 10);
        for _ in 0..300 {
            p.action("longer").unwrap();
        }
        assert_eq!(p.view().custom_skin[8], 255);
        for _ in 0..300 {
            p.action("shorter").unwrap();
        }
        assert_eq!(p.view().custom_skin[8], 1);
        for _ in 0..130 {
            p.action("add-stripe").unwrap();
        }
        assert_eq!(p.view().custom_skin.len(), 254);
        let before = p.clone();
        assert!(p.action("connect").is_err());
        assert_eq!(p, before);
        p.action("reset").unwrap();
        assert_eq!(p.view().nickname, "Saved");
        assert!(p.view().custom_skin.is_empty());
    }
}

#[test]
fn every_stock_choice_and_custom_palette_reuses_the_existing_resolver() {
    use slither_client::presentation::resolve_skin;
    let mut p = MenuPreferences::new(false);
    for skin in 0..=65 {
        p.select(skin, &[]).unwrap();
        assert_eq!(
            resolve_skin(p.view().skin, &p.view().custom_skin, false).unwrap(),
            resolve_skin(skin, &[], false).unwrap()
        );
    }
    for palette in 0..=41 {
        let bytes = [vec![0; 8], vec![1, palette]].concat();
        if matches!(palette, 0..=35 | 37 | 39 | 41) {
            p.select(24, &bytes).unwrap();
            let resolved = resolve_skin(p.view().skin, &p.view().custom_skin, false).unwrap();
            assert!(resolved.custom);
            assert_eq!(resolved.base_palette, usize::from(palette));
        } else {
            assert!(p.select(24, &bytes).is_err());
        }
    }
    let mut local = MenuPreferences::new(true);
    for skin in 3..=255 {
        assert!(local.select(skin, &[]).is_err());
    }
    for palette in 3..=255 {
        assert!(
            local
                .select(0, &[0, 0, 0, 0, 0, 0, 0, 0, 1, palette])
                .is_err()
        );
    }
    assert!(local.select(0, &[1, 0, 0, 0, 0, 0, 0, 0, 1, 0]).is_err());
}

#[test]
fn arbitrary_bounded_restore_inputs_never_publish_partial_choices() {
    for length in 0..=MAX_PREFERENCE_BYTES + 1 {
        assert_eq!(
            MenuPreferences::restore(false, &"x".repeat(length)),
            MenuPreferences::new(false)
        );
    }
    let mut p = MenuPreferences::new(false);
    p.set_nickname("unchanged").unwrap();
    for _ in 0..=65 {
        p.action("next-skin").unwrap();
    }
    assert_eq!(p.view().skin, 0);
    let before = p.clone();
    for action in [
        "longer",
        "shorter",
        "next-color",
        "previous-color",
        "next-stripe",
        "add-stripe",
        "remove-stripe",
    ] {
        p.action(action).unwrap();
        assert_eq!(p, before, "disabled action {action}");
    }
}
