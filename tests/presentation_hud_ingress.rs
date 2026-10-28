//! Authored synthetic indexed HUD ingress, with no reference execution or assets.

use std::cell::{Cell, RefCell};

use slither_client::{
    presentation::{
        AnimatedClient, AppearancePresentation, BodyAsset, BodyAssetStatus,
        ClientPresentationError, ClientScoreView, FacePresentation, FoodFactory, FoodSource,
        HudCommandGuard, HudIngressError, HudIngressEventKind as Kind, HudIngressPlan,
        HudIngressReport, PairedFaceGeometry, PreyFactory, ScoreError, ScoreStatus, ScoreTables,
        StandardEyeGeometry, food_palette,
    },
    protocol::{ElapsedHeader, MAX_FRAME_COMMANDS},
    state::{ClientState, FrameReport, StateError},
};

fn u24(value: u32) -> [u8; 3] {
    let bytes = value.to_be_bytes();
    [bytes[1], bytes[2], bytes[3]]
}

fn setup(n: u16) -> Vec<u8> {
    let mut p = vec![b'a'];
    p.extend(u24(1000));
    for value in [n, 100, 20] {
        p.extend(value.to_be_bytes());
    }
    p.push(48);
    for value in [539_u16, 40, 1400, 33, 28, 430] {
        p.extend(value.to_be_bytes());
    }
    p.extend([19, 42]);
    p
}

fn appearance(id: u16, points: usize) -> Vec<u8> {
    let mut p = vec![b's'];
    p.extend(id.to_be_bytes());
    p.extend(u24(0));
    p.push(b'0');
    p.extend(u24(0));
    p.extend(4250_u16.to_be_bytes());
    p.extend(u24(0));
    p.push(0);
    p.extend(u24(500_000));
    p.extend(u24(5000));
    p.extend([0, 0, 255]);
    if points > 0 {
        p.extend(u24((100_000 - points as u32 * 42) * 5));
        p.extend(u24(5000));
        for _ in 2..points {
            p.extend([211, 127]);
        }
        if points >= 2 {
            p.extend(0_u16.to_be_bytes());
        }
    }
    p
}

fn mass(id: u16, numerator: u32) -> Vec<u8> {
    let mut p = vec![b'h'];
    p.extend(id.to_be_bytes());
    p.extend(u24(numerator));
    p
}

fn prey() -> Vec<u8> {
    let mut p = vec![b'y', 0, 31, 9];
    p.extend(u24(10_000));
    p.extend(u24(5000));
    p.extend([20, b'0']);
    p.extend(u24(0));
    p.extend(u24(0));
    p.extend(1000_u16.to_be_bytes());
    p
}

fn bundle(commands: &[Vec<u8>]) -> Vec<u8> {
    let mut bytes = Vec::new();
    for command in commands {
        bytes.extend((command.len() as u16).to_be_bytes());
        bytes.extend(command);
    }
    bytes
}

fn guard(playing: bool, close_requested: bool, death_pending: bool) -> HudCommandGuard {
    HudCommandGuard {
        playing,
        close_requested,
        death_pending,
    }
}

fn plan<'a>(guards: &'a [HudCommandGuard], indices: &'a [usize]) -> HudIngressPlan<'a> {
    HudIngressPlan {
        schema: 1,
        command_count: guards.len(),
        guards,
        final_capture_indices: indices,
    }
}

fn source(handle: u64) -> FoodSource {
    FoodSource::new(
        BodyAsset {
            handle,
            revision: 1,
            width: 20,
            height: 16,
            status: BodyAssetStatus::Ready,
        },
        20.,
        16.,
        10.,
        8.,
    )
    .unwrap()
}

fn food_factory(raw: u8) -> FoodFactory {
    FoodFactory {
        random_phase_unit: 0.,
        random_wobble_unit: 0.5,
        palette: food_palette(raw),
        image_count: 1,
        bodies: vec![source(1)],
        outlines: vec![source(2)],
        glows: vec![source(3)],
    }
}

fn prey_factory(raw: u8) -> PreyFactory {
    PreyFactory {
        random_phase_unit: 0.25,
        random_rate_unit: 0.5,
        palette: raw % 9,
        bodies: vec![source(4)],
        glows: vec![source(5)],
    }
}

fn apply(
    c: &mut AnimatedClient,
    commands: &[Vec<u8>],
    guards: &[HudCommandGuard],
    captures: &[usize],
) -> Result<HudIngressReport, ClientPresentationError> {
    c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud(
        &bundle(commands),
        ElapsedHeader::Absent,
        |_| Ok(FacePresentation::default()),
        |p, _| Ok(food_factory(p.raw_color)),
        |p, _| Ok(prey_factory(p.raw_color)),
        |_, _| Ok(()),
        plan(guards, captures),
    )
}

fn empty() -> AnimatedClient {
    let mut c = AnimatedClient::new(0.).unwrap();
    c.enable_score_tracking().unwrap();
    c
}

fn ready() -> AnimatedClient {
    let mut c = empty();
    apply(
        &mut c,
        &[setup(17), appearance(7, 3)],
        &[guard(false, false, false); 2],
        &[],
    )
    .unwrap();
    c
}

fn finals(report: &HudIngressReport) -> Vec<(usize, ClientScoreView)> {
    report
        .events()
        .iter()
        .filter_map(|event| match event.kind {
            Kind::FinalScore { view } => Some((event.command_index, view)),
            _ => None,
        })
        .collect()
}

fn schedules(report: &HudIngressReport) -> Vec<usize> {
    report
        .events()
        .iter()
        .filter_map(|event| {
            matches!(event.kind, Kind::OwnLengthScheduled { .. }).then_some(event.command_index)
        })
        .collect()
}

fn assert_ready(view: ClientScoreView) {
    let own = view.own.unwrap();
    let expected = ScoreTables::new(view.table_max.unwrap())
        .unwrap()
        .score(own.score_index, own.fractional_mass)
        .unwrap();
    let ScoreStatus::Ready(actual) = view.status else {
        panic!("expected ready")
    };
    assert_eq!(actual.to_bits(), expected.to_bits());
}

#[test]
fn zero_event_controls_and_opaque_commands_keep_original_positions() {
    let mut c = ready();
    let before = c.clone();
    let commands = [
        vec![b'?'],
        vec![b'p'],
        vec![b'v', 2],
        vec![b'm'],
        vec![b'v', 1],
        vec![b'?'],
        vec![b'v', 255],
    ];
    let guards = [guard(true, false, false); 7];
    // Session decisions are supplied; native does not infer a close from preceding v2.
    let report = apply(&mut c, &commands, &guards, &[4, 6]).unwrap();
    assert_eq!(
        finals(&report),
        [(4, before.score_view()), (6, before.score_view())]
    );
    assert_eq!(report.schema(), 1);
    assert_eq!(report.command_count(), 7);
    assert_eq!(report.setup_draws(), 0);
    assert_eq!(report.frame_report().ignored, 7);
    assert_eq!(c.draw_serial(), before.draw_serial());
    let mut expected = before;
    expected
        .apply_frame(&bundle(&commands), ElapsedHeader::Absent)
        .unwrap();
    assert_eq!(c, expected);
}

#[test]
fn all_v_values_and_all_supplied_guard_combinations_have_exact_membership() {
    let original = ready();
    for value in 0..=u8::MAX {
        for playing in [false, true] {
            for close in [false, true] {
                for death in [false, true] {
                    let mut c = original.clone();
                    let expected = value != 2 && playing && !close;
                    let indices = if expected { vec![0] } else { vec![] };
                    let report = apply(
                        &mut c,
                        &[vec![b'v', value]],
                        &[guard(playing, close, death)],
                        &indices,
                    )
                    .unwrap();
                    assert_eq!(finals(&report).len(), usize::from(expected));
                    assert_eq!(c.score_view(), original.score_view());
                }
            }
        }
    }
}

#[test]
fn repeated_v1_death_pending_captures_and_close_suppression_follow_plan() {
    let mut c = ready();
    let commands = [
        vec![b'v', 1],
        vec![b'v', 1],
        vec![b'v', 0],
        vec![b'v', 1],
        vec![b'v', 2],
    ];
    let guards = [
        guard(true, false, false),
        guard(true, false, true),
        guard(true, false, true),
        guard(true, true, true),
        guard(true, true, true),
    ];
    let report = apply(&mut c, &commands, &guards, &[0, 1, 2]).unwrap();
    assert_eq!(
        finals(&report).iter().map(|v| v.0).collect::<Vec<_>>(),
        [0, 1, 2]
    );
}

#[test]
fn capture_membership_and_plan_errors_reject_before_any_callback() {
    let commands = [
        setup(29),
        appearance(7, 3),
        vec![b'v', 1],
        vec![b'p'],
        vec![b'v', 255],
        vec![b'v', 2],
    ];
    let guards = [guard(true, false, false); 6];
    let original = empty();
    for indices in [
        vec![],
        vec![2],
        vec![4],
        vec![2, 4, 5],
        vec![2, 2, 4],
        vec![4, 2],
        vec![2, 3, 4],
        vec![2, 4, 6],
    ] {
        let mut c = original.clone();
        let calls = Cell::new(0);
        let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
            &bundle(&commands), ElapsedHeader::Absent,
            |_| { calls.set(calls.get() + 1); Ok(FacePresentation::default()) },
            |_, _| { calls.set(calls.get() + 1); Ok(food_factory(0)) },
            |_, _| { calls.set(calls.get() + 1); Ok(prey_factory(0)) },
            |_, _| { calls.set(calls.get() + 1); Ok(()) }, plan(&guards, &indices));
        assert_eq!(
            result,
            Err(ClientPresentationError::State(StateError::Hud(
                HudIngressError::InvalidCaptureIndices
            )))
        );
        assert_eq!(calls.get(), 0);
        assert_eq!(c, original);
    }
    for invalid in [
        HudIngressPlan {
            schema: 3,
            ..plan(&guards, &[2, 4])
        },
        HudIngressPlan {
            command_count: 0,
            ..plan(&guards, &[2, 4])
        },
        HudIngressPlan {
            command_count: 4097,
            ..plan(&guards, &[2, 4])
        },
        HudIngressPlan {
            guards: &guards[..5],
            ..plan(&guards, &[2, 4])
        },
        HudIngressPlan {
            command_count: 5,
            guards: &guards[..5],
            final_capture_indices: &[],
            schema: 1,
        },
    ] {
        let mut c = original.clone();
        let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
            &bundle(&commands), ElapsedHeader::Absent, |_| panic!("appearance before validation"),
            |_, _| panic!("food before validation"), |_, _| panic!("prey before validation"),
            |_, _| panic!("setup before validation"), invalid);
        assert!(result.is_err());
        assert_eq!(c, original);
    }
}

#[test]
fn controls_protocol_and_all_typed_tails_precede_callbacks() {
    for tail in [
        vec![b'p', 0],
        vec![b'v'],
        vec![b'v', 1, 0],
        vec![b'6', 1],
        vec![b'h'],
        vec![b'f'],
        vec![b'y', 0, 1, 9],
        vec![b'R'],
        {
            let mut a = setup(17);
            a[23] = 18;
            a
        },
        {
            let mut s = appearance(8, 3);
            s[6] = 0;
            s
        },
    ] {
        let mut c = empty();
        let before = c.clone();
        let commands = [setup(29), appearance(7, 3), tail];
        let guards = [guard(false, false, false); 3];
        assert!(c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
            &bundle(&commands), ElapsedHeader::Absent, |_| panic!("appearance ran"),
            |_, _| panic!("food ran"), |_, _| panic!("prey ran"), |_, _| panic!("setup ran"),
            plan(&guards, &[])).is_err());
        assert_eq!(c, before);
    }
}

#[test]
fn setup_callback_and_final_samples_are_taken_at_each_event_time() {
    let mut c = empty();
    let commands = [
        setup(17),
        appearance(7, 3),
        mass(7, 0),
        vec![b'R', 3],
        setup(29),
        mass(7, 0),
        vec![b'v', 1],
        vec![b'R', 5],
        mass(7, 8_388_608),
        vec![b'v', 1],
        setup(17),
    ];
    let guards = [guard(true, false, true); 11];
    let observed = RefCell::new(Vec::new());
    let draws = Cell::new(0);
    let report = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
        &bundle(&commands), ElapsedHeader::Absent, |_| Ok(FacePresentation::default()),
        |_, _| unreachable!(), |_, _| unreachable!(), |stage, s| {
            assert_eq!(stage.score_view().table_max, Some(s.max_segments));
            observed.borrow_mut().push(stage.score_view());
            stage.prepare_draw(800, 600)?;
            draws.set(draws.get() + 1);
            Ok(())
        }, plan(&guards, &[6, 9])).unwrap();
    assert_eq!(draws.get(), 3);
    assert_eq!(report.setup_draws(), 3);
    assert_eq!(c.draw_serial(), 3);
    let setup_views: Vec<_> = report
        .events()
        .iter()
        .filter_map(|event| match event.kind {
            Kind::SetupDraw { view } => Some(view),
            _ => None,
        })
        .collect();
    assert_eq!(setup_views, *observed.borrow());
    assert_eq!(setup_views[0].status, ScoreStatus::NoOwn);
    assert_eq!(setup_views[1].table_max, Some(29));
    assert_eq!(setup_views[1].own.unwrap().score_adjustment, 3);
    assert_eq!(setup_views[2].table_max, Some(17));
    let captured = finals(&report);
    assert_eq!(captured[0].1, setup_views[1]);
    assert_eq!(captured[1].1.table_max, Some(29));
    assert_eq!(captured[1].1.own.unwrap().score_adjustment, 5);
    assert_eq!(
        captured[1].1.own.unwrap().fractional_mass.to_bits(),
        (8_388_608_f64 / 16_777_215.).to_bits()
    );
    assert_ne!(captured[1].1, c.score_view());
    for (_, view) in captured {
        assert_ready(view);
    }
    assert_eq!(schedules(&report), [1, 2, 5, 8]);
    let order: Vec<_> = report
        .events()
        .iter()
        .map(|event| {
            (
                event.command_index,
                match event.kind {
                    Kind::Setup { .. } => "setup",
                    Kind::SetupDraw { .. } => "setup-draw",
                    Kind::OwnLengthScheduled { .. } => "own",
                    Kind::FinalScore { .. } => "final",
                    Kind::Leaderboard { .. } => "leaderboard",
                },
            )
        })
        .collect();
    assert_eq!(
        order,
        [
            (0, "setup"),
            (0, "setup-draw"),
            (1, "own"),
            (2, "own"),
            (4, "setup"),
            (4, "setup-draw"),
            (5, "own"),
            (6, "final"),
            (8, "own"),
            (9, "final"),
            (10, "setup"),
            (10, "setup-draw")
        ]
    );
}

#[test]
fn final_before_later_mass_adjustment_setup_and_removal_does_not_read_bundle_end() {
    let mut c = ready();
    let expected = c.score_view();
    let commands = [
        vec![b'v', 1],
        mass(7, 16_777_215),
        vec![b'R', 255],
        setup(29),
        vec![b's', 0, 7, 0],
    ];
    let report = apply(&mut c, &commands, &[guard(true, false, false); 5], &[0]).unwrap();
    assert_eq!(finals(&report), [(0, expected)]);
    assert_ne!(c.score_view(), expected);
    assert!(c.snake(7).is_none());
    assert_eq!(c.own_token(), expected.own.map(|v| v.token));
}

#[test]
fn leaderboard_validates_complete_tail_even_when_playing_false_and_keeps_only_header() {
    let header = vec![b'l', 255, 0, 0, 0, 0];
    let mut rows = header.clone();
    for byte in 0..=u8::MAX {
        rows.extend([0, 4, 0, 0, 0, byte, 1, byte]);
    }
    let mut c = ready();
    let report = apply(
        &mut c,
        &[header.clone(), rows.clone(), vec![b'm']],
        &[
            guard(false, false, false),
            guard(true, true, true),
            guard(true, false, false),
        ],
        &[],
    )
    .unwrap();
    assert_eq!(report.frame_report().ignored, 1);
    assert_eq!(report.events().len(), 1);
    assert_eq!(report.events()[0].command_index, 1);
    assert_eq!(
        report.events()[0].kind,
        Kind::Leaderboard {
            local_row: 255,
            rank: 0,
            population: 0,
            death_pending: true
        }
    );
    let mut bad = header.clone();
    bad.extend([0, 4, 0, 0, 0, 10, 2, 65]);
    for playing in [false, true] {
        let before = c.clone();
        let commands = [setup(29), vec![b'R', 9], bad.clone()];
        let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
            &bundle(&commands), ElapsedHeader::Absent, |_| panic!(), |_, _| panic!(), |_, _| panic!(),
            |_, _| panic!("late l tail must reject before Setup callback"), plan(&[guard(playing, false, false); 3], &[]));
        assert!(matches!(
            result,
            Err(ClientPresentationError::State(StateError::Hud(
                HudIngressError::Leaderboard(_)
            )))
        ));
        assert_eq!(c, before);
    }
    for score_enabled in [false, true] {
        let mut legacy = AnimatedClient::new(0.).unwrap();
        if score_enabled {
            legacy.enable_score_tracking().unwrap();
        }
        assert_eq!(
            legacy
                .apply_frame(&bad, ElapsedHeader::Absent)
                .unwrap()
                .ignored,
            1
        );
    }
    let mut state = ClientState::default();
    assert_eq!(
        state
            .apply_frame_with_events(&bad, ElapsedHeader::Absent)
            .unwrap()
            .events
            .len(),
        0
    );
}

#[test]
fn own_scheduling_includes_equal_mass_tail_and_growth_but_excludes_r_normal_and_remote() {
    let mut c = ready();
    let commands = [
        mass(7, 0),
        mass(7, 0),
        vec![b'r', 0, 7],
        vec![b'r', 0, 7],
        vec![b'r', 0, 7],
        vec![b'r', 0, 7],
        vec![b'R', 3],
        vec![b'=', 0, 0, 0, 100, 0, 100],
        vec![b'+', 0, 0, 0, 100, 0, 100, 0, 0, 0],
        appearance(8, 3),
        mass(8, 0),
        mass(99, 0),
        vec![b'r', 0, 8],
        setup(29),
    ];
    let report = apply(&mut c, &commands, &[guard(false, false, false); 14], &[]).unwrap();
    assert_eq!(schedules(&report), [0, 1, 2, 3, 4, 5, 8]);
    for event in report.events() {
        if let Kind::OwnLengthScheduled { token } = event.kind {
            assert_eq!(Some(token), c.own_token());
        }
    }
    assert_eq!(c.own_snake().unwrap().metrics().logical_segments, 1);
}

#[test]
fn retained_own_score_and_compact_growth_survive_removal_reuse_and_expiry() {
    for died in [false, true] {
        let mut c = ready();
        let token = c.own_token().unwrap();
        let mut expected = c.score_view().own.unwrap();
        apply(
            &mut c,
            &[vec![b's', 0, 7, u8::from(died)]],
            &[guard(true, false, false)],
            &[],
        )
        .unwrap();
        if died {
            for step in 1..=200 {
                c.advance(f64::from(step * 40), false).unwrap();
            }
        }
        let commands = [
            appearance(7, 5),
            mass(7, 16_777_215),
            vec![b'r', 0, 7],
            vec![b'R', 9],
            vec![b'v', 1],
            vec![b'+', 0, 0, 0, 100, 0, 100, 0, 0, 0],
            vec![b'v', 1],
        ];
        let report = apply(&mut c, &commands, &[guard(true, false, true); 7], &[4, 6]).unwrap();
        assert_eq!(schedules(&report), [5]);
        expected.score_adjustment = 9;
        expected.score_index = expected.logical_segments + 9;
        assert_eq!(finals(&report)[0].1.own, Some(expected));
        assert_eq!(
            finals(&report)[1].1.own.unwrap().logical_segments,
            expected.logical_segments + 1
        );
        assert_eq!(c.own_token(), Some(token));
        assert_ne!(c.snake(7).unwrap().metrics().fam, expected.fractional_mass);
    }
}

#[test]
fn missing_own_tables_or_unsupported_final_roll_back_everything() {
    let mut no_tables = empty();
    let before = no_tables.clone();
    assert_eq!(
        apply(
            &mut no_tables,
            &[vec![b'v', 1]],
            &[guard(true, false, false)],
            &[0]
        ),
        Err(ClientPresentationError::FinalScoreUnavailable(
            ScoreStatus::NoTables
        ))
    );
    assert_eq!(no_tables, before);
    let mut no_own = empty();
    let before = no_own.clone();
    assert_eq!(
        apply(
            &mut no_own,
            &[setup(17), vec![b'v', 1]],
            &[guard(true, false, false); 2],
            &[1]
        ),
        Err(ClientPresentationError::FinalScoreUnavailable(
            ScoreStatus::NoOwn
        ))
    );
    assert_eq!(no_own, before);
    let mut c = empty();
    apply(
        &mut c,
        &[setup(1), appearance(7, 2049)],
        &[guard(true, false, false); 2],
        &[],
    )
    .unwrap();
    let before = c.clone();
    assert_eq!(
        apply(
            &mut c,
            &[vec![b'R', 255], vec![b'v', 1]],
            &[guard(true, false, false); 2],
            &[1]
        ),
        Err(ClientPresentationError::FinalScoreUnavailable(
            ScoreStatus::Unsupported(ScoreError::IndexOutOfRange)
        ))
    );
    assert_eq!(c, before);
    let report = apply(
        &mut c,
        &[vec![b'R', 255], setup(1)],
        &[guard(false, false, false); 2],
        &[],
    )
    .unwrap();
    assert!(matches!(
        report.events()[1].kind,
        Kind::SetupDraw {
            view: ClientScoreView {
                status: ScoreStatus::Unsupported(ScoreError::IndexOutOfRange),
                ..
            }
        }
    ));
    let mut absent = empty();
    assert!(
        apply(
            &mut absent,
            &[vec![b'v', 2], vec![b'v', 1]],
            &[guard(false, false, false), guard(true, true, false)],
            &[]
        )
        .is_ok()
    );
}

#[test]
fn tracking_is_never_implicitly_enabled_and_r_without_original_own_is_rejected() {
    let mut c = AnimatedClient::new(0.).unwrap();
    let before = c.clone();
    assert_eq!(
        apply(&mut c, &[setup(17)], &[guard(false, false, false)], &[]),
        Err(ClientPresentationError::ScoreTrackingRequired)
    );
    assert_eq!(c, before);
    c.enable_score_tracking().unwrap();
    let before = c.clone();
    assert_eq!(
        apply(
            &mut c,
            &[setup(17), vec![b'R', 0]],
            &[guard(false, false, false); 2],
            &[]
        ),
        Err(ClientPresentationError::ScoreOwnRequired)
    );
    assert_eq!(c, before);
}

#[test]
fn late_factory_and_setup_callback_failures_preserve_entire_prior_client() {
    let mut c = ready();
    let commands = [
        setup(29),
        mass(7, 8_388_608),
        vec![b'R', 9],
        appearance(8, 3),
        vec![b'f', 1, 2, 8, 9, 5],
        prey(),
        setup(17),
    ];
    for fail in ["appearance", "food", "prey", "setup"] {
        let before = c.clone();
        let calls = RefCell::new(Vec::new());
        let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
            &bundle(&commands), ElapsedHeader::Absent,
            |_| { calls.borrow_mut().push("appearance"); if fail == "appearance" { Err(ClientPresentationError::Limit) } else { Ok(FacePresentation::default()) } },
            |p, _| { calls.borrow_mut().push("food"); if fail == "food" { Err(ClientPresentationError::Limit) } else { Ok(food_factory(p.raw_color)) } },
            |p, _| { calls.borrow_mut().push("prey"); if fail == "prey" { Err(ClientPresentationError::Limit) } else { Ok(prey_factory(p.raw_color)) } },
            |stage, s| { calls.borrow_mut().push("setup"); stage.prepare_draw(800, 600)?;
                if fail == "setup" && s.max_segments == 17 { Err(ClientPresentationError::Limit) } else { Ok(()) } },
            plan(&[guard(true, false, true); 7], &[]));
        assert_eq!(
            result,
            Err(ClientPresentationError::Limit),
            "{fail}: {:?}",
            calls.borrow()
        );
        assert_eq!(c, before);
        assert!(!calls.borrow().is_empty()); // External callback observations cannot roll back.
    }
}

#[test]
fn successful_full_factories_match_legacy_transaction_without_extra_draw_or_update() {
    let mut hud = empty();
    let mut legacy = hud.clone();
    let commands = [
        setup(17),
        appearance(7, 3),
        vec![b'f', 1, 2, 8, 9, 5],
        prey(),
        mass(7, 0),
        setup(29),
        vec![b'p'],
        vec![b'v', 1],
    ];
    let bytes = bundle(&commands);
    let legacy_trace = RefCell::new(Vec::new());
    let hud_trace = RefCell::new(Vec::new());
    let legacy_report = legacy.apply_frame_with_face_presentation_and_all_factories_and_setup::<ClientPresentationError, _, _, _, _>(
        &bytes, ElapsedHeader::Absent,
        |_| { legacy_trace.borrow_mut().push("appearance"); Ok(FacePresentation::default()) },
        |p, _| { legacy_trace.borrow_mut().push("food"); Ok(food_factory(p.raw_color)) },
        |p, _| { legacy_trace.borrow_mut().push("prey"); Ok(prey_factory(p.raw_color)) },
        |stage, _| { legacy_trace.borrow_mut().push("setup"); stage.prepare_draw(800, 600)?; Ok(()) }).unwrap();
    let report = hud.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
        &bytes, ElapsedHeader::Absent,
        |_| { hud_trace.borrow_mut().push("appearance"); Ok(FacePresentation::default()) },
        |p, _| { hud_trace.borrow_mut().push("food"); Ok(food_factory(p.raw_color)) },
        |p, _| { hud_trace.borrow_mut().push("prey"); Ok(prey_factory(p.raw_color)) },
        |stage, _| { hud_trace.borrow_mut().push("setup"); stage.prepare_draw(800, 600)?; Ok(()) },
        plan(&[guard(true, false, false); 8], &[7])).unwrap();
    assert_eq!(hud, legacy);
    assert_eq!(report.frame_report(), legacy_report);
    assert_eq!(hud_trace, legacy_trace);
    assert_eq!(
        *hud_trace.borrow(),
        ["setup", "appearance", "food", "prey", "setup"]
    );
    assert_eq!(report.setup_draws(), 2);
    assert_eq!(hud.draw_serial(), 2);
    assert_eq!(hud.received().frames_applied, 1);
    assert_eq!(hud.received().commands_applied, 8);
}

#[test]
fn maximum_command_and_journal_bounds_are_inclusive_and_read_only() {
    let mut c = empty();
    let commands = vec![setup(1); MAX_FRAME_COMMANDS];
    let report = apply(
        &mut c,
        &commands,
        &vec![guard(false, false, false); MAX_FRAME_COMMANDS],
        &[],
    )
    .unwrap();
    assert_eq!(report.command_count(), MAX_FRAME_COMMANDS);
    assert_eq!(report.setup_draws(), MAX_FRAME_COMMANDS);
    assert_eq!(report.events().len(), 2 * MAX_FRAME_COMMANDS);
    assert_eq!(c.draw_serial(), 0); // Successful callbacks alone do not claim actual draws.
    let readonly: &[slither_client::presentation::HudIngressEvent] = report.events();
    assert_eq!(
        readonly.last().unwrap().command_index,
        MAX_FRAME_COMMANDS - 1
    );
    let original = c.clone();
    assert!(
        apply(
            &mut c,
            &vec![vec![b'p']; MAX_FRAME_COMMANDS + 1],
            &vec![guard(false, false, false); MAX_FRAME_COMMANDS + 1],
            &[]
        )
        .is_err()
    );
    assert_eq!(c, original);
}

#[test]
fn source_has_one_native_decode_one_leaderboard_parse_and_shared_presentation_match() {
    let state = include_str!("../src/state.rs");
    let client = include_str!("../src/presentation/client.rs");
    assert_eq!(
        state
            .matches("protocol::decode_frame(bytes, header)")
            .count(),
        1
    );
    assert_eq!(
        state
            .matches("protocol::hud::parse_leaderboard(command)")
            .count(),
        1
    );
    let ingress = client
        .split("fn apply_frame_face_transaction")
        .nth(1)
        .unwrap()
        .split("/// Advance the boundary")
        .next()
        .unwrap();
    assert_eq!(ingress.matches("match event {").count(), 1);
    assert_eq!(ingress.matches("on_setup(&mut next").count(), 1);
    assert!(!ingress.contains("prepare_draw("));
    assert!(!ingress.contains(".advance("));
    assert!(!ingress.contains("decode_frame("));
    assert!(!state.contains("parse_announcement("));
}

#[test]
fn every_growth_addressing_form_marks_only_actual_retained_own() {
    let mut c = ready();
    let commands = [
        vec![b'n', 0, 7, 0, 0, 0],
        vec![b'N', 0, 0, 0],
        vec![b'+', 0, 7, 0, 0, 0, 100, 0, 100, 0, 0, 0],
        appearance(8, 3),
        vec![b'n', 0, 8, 0, 0, 0],
        vec![b'+', 0, 8, 0, 0, 0, 100, 0, 100, 0, 0, 0],
        vec![b'n', 0, 99, 0, 0, 0],
        vec![b'g', 0, 7],
        vec![b'G'],
    ];
    let report = apply(&mut c, &commands, &[guard(true, false, false); 9], &[]).unwrap();
    assert_eq!(schedules(&report), [0, 1, 2]);
    assert_eq!(c.own_snake().unwrap().metrics().logical_segments, 6);
}

#[test]
fn duplicate_setup_samples_own_appearance_then_tail_without_observation_draws() {
    let mut c = empty();
    let commands = [
        setup(17),
        setup(17),
        appearance(0, 3),
        vec![b'r', 0, 0],
        vec![b'R', 3],
        setup(17),
        setup(29),
    ];
    let report = apply(&mut c, &commands, &[guard(false, true, true); 7], &[]).unwrap();
    let views: Vec<_> = report
        .events()
        .iter()
        .filter_map(|event| match event.kind {
            Kind::SetupDraw { view } => Some((event.command_index, view)),
            _ => None,
        })
        .collect();
    assert_eq!(report.setup_draws(), 4);
    assert_eq!(views.iter().map(|v| v.0).collect::<Vec<_>>(), [0, 1, 5, 6]);
    assert_eq!(views[0].1.status, ScoreStatus::NoOwn);
    assert_eq!(views[1].1.status, ScoreStatus::NoOwn);
    let own = views[2].1.own.unwrap();
    assert_eq!(own.id, 0);
    assert_eq!(own.logical_segments, 2);
    assert_eq!(own.score_adjustment, 3);
    assert_eq!(views[2].1.table_max, Some(17));
    assert_eq!(views[3].1.table_max, Some(29));
    assert_eq!(views[3].1.own, Some(own));
    assert_eq!(schedules(&report), [2, 3]);
    assert_eq!(c.draw_serial(), 0);
}

#[test]
fn a_late_world_tail_preserves_old_client_and_prevents_all_callbacks() {
    let mut c = ready();
    let before = c.clone();
    let commands = [
        setup(29),
        vec![b'R', 9],
        mass(7, 16_777_215),
        appearance(8, 3),
        vec![b'h'],
    ];
    let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
        &bundle(&commands), ElapsedHeader::Absent, |_| panic!(), |_, _| panic!(), |_, _| panic!(),
        |_, _| panic!(), plan(&[guard(true, false, false); 5], &[]));
    assert_eq!(
        result,
        Err(ClientPresentationError::State(StateError::InvalidPacket(
            b'h'
        )))
    );
    assert_eq!(c, before);
}

fn legacy_wrapper(
    index: usize,
    c: &mut AnimatedClient,
    bytes: &[u8],
) -> Result<FrameReport, ClientPresentationError> {
    let header = ElapsedHeader::Absent;
    match index {
        0 => c.apply_frame(bytes, header),
        1 => c.apply_frame_with_eye_geometry(bytes, header, |_| Ok(StandardEyeGeometry::default())),
        2 => c.apply_frame_with_face_geometry(bytes, header, |_| Ok(PairedFaceGeometry::default())),
        3 => c.apply_frame_with_factories(
            bytes,
            header,
            |_| Ok(PairedFaceGeometry::default()),
            |p, _| Ok(food_factory(p.raw_color)),
        ),
        4 => c.apply_frame_with_all_factories(
            bytes,
            header,
            |_| Ok(PairedFaceGeometry::default()),
            |p, _| Ok(food_factory(p.raw_color)),
            |p, _| Ok(prey_factory(p.raw_color)),
        ),
        5 => c.apply_frame_with_appearance(bytes, header, |_| {
            Ok(AppearancePresentation {
                face: PairedFaceGeometry::default(),
                antenna: None,
            })
        }),
        6 => c.apply_frame_with_appearance_and_factories(
            bytes,
            header,
            |_| {
                Ok(AppearancePresentation {
                    face: PairedFaceGeometry::default(),
                    antenna: None,
                })
            },
            |p, _| Ok(food_factory(p.raw_color)),
        ),
        7 => c.apply_frame_with_appearance_and_all_factories(
            bytes,
            header,
            |_| {
                Ok(AppearancePresentation {
                    face: PairedFaceGeometry::default(),
                    antenna: None,
                })
            },
            |p, _| Ok(food_factory(p.raw_color)),
            |p, _| Ok(prey_factory(p.raw_color)),
        ),
        8 => {
            c.apply_frame_with_face_presentation(bytes, header, |_| Ok(FacePresentation::default()))
        }
        9 => c.apply_frame_with_face_presentation_and_factories(
            bytes,
            header,
            |_| Ok(FacePresentation::default()),
            |p, _| Ok(food_factory(p.raw_color)),
        ),
        10 => c.apply_frame_with_face_presentation_and_all_factories(
            bytes,
            header,
            |_| Ok(FacePresentation::default()),
            |p, _| Ok(food_factory(p.raw_color)),
            |p, _| Ok(prey_factory(p.raw_color)),
        ),
        11 => c.apply_frame_with_face_presentation_and_factories_and_setup(
            bytes,
            header,
            |_| Ok(FacePresentation::default()),
            |p, _| Ok(food_factory(p.raw_color)),
            |_, _| Ok(()),
        ),
        12 => c.apply_frame_with_face_presentation_and_all_factories_and_setup(
            bytes,
            header,
            |_| Ok(FacePresentation::default()),
            |p, _| Ok(food_factory(p.raw_color)),
            |p, _| Ok(prey_factory(p.raw_color)),
            |_, _| Ok(()),
        ),
        _ => unreachable!(),
    }
}

#[test]
fn all_thirteen_existing_public_wrappers_keep_legacy_r_controls_and_opaque_hud_counts() {
    for score in [false, true] {
        for index in 0..13 {
            let mut c = AnimatedClient::new(0.).unwrap();
            if score {
                c.enable_score_tracking().unwrap();
            }
            let commands = [
                setup(17),
                appearance(7, 3),
                vec![b'R', 9],
                vec![b'l'],
                vec![b'm'],
                vec![b'p', 0],
                vec![b'v'],
                vec![b'6'],
            ];
            let report = legacy_wrapper(index, &mut c, &bundle(&commands)).unwrap();
            assert_eq!(
                report,
                FrameReport {
                    commands: 8,
                    ignored: if score { 5 } else { 6 }
                }
            );
            assert_eq!(c.draw_serial(), 0);
            if score {
                assert_eq!(c.score_view().own.unwrap().score_adjustment, 9);
            } else {
                assert_eq!(c.score_view().status, ScoreStatus::Disabled);
            }
            let before = c.clone();
            assert!(legacy_wrapper(index, &mut c, &bundle(&[setup(29), vec![b'h']])).is_err());
            assert_eq!(c, before);
        }
    }
}

// Schema-2 fixtures are original synthetic packets, not external captures.
fn apply_schema_bytes(
    c: &mut AnimatedClient,
    bytes: &[u8],
    guards: &[HudCommandGuard],
    captures: &[usize],
    schema: u8,
) -> Result<HudIngressReport, ClientPresentationError> {
    c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud(
        bytes,
        ElapsedHeader::Absent,
        |_| Ok(FacePresentation::default()),
        |p, _| Ok(food_factory(p.raw_color)),
        |p, _| Ok(prey_factory(p.raw_color)),
        |_, _| Ok(()),
        HudIngressPlan {
            schema,
            ..plan(guards, captures)
        },
    )
}

fn raw_board(rows: &[(u16, u32, u8, Vec<u8>)]) -> Vec<u8> {
    let mut p = vec![b'l', 1, 0, 7, 0, 12];
    for (count, numerator, color, name) in rows {
        p.extend(count.to_be_bytes());
        p.extend(u24(*numerator));
        p.extend([*color, u8::try_from(name.len()).unwrap()]);
        p.extend(name);
    }
    p
}

#[test]
fn explicit_rows_distinguish_the_red_names_while_schema_one_remains_equal() {
    let one = raw_board(&[(4, 0, 10, vec![65])]);
    let two = raw_board(&[(4, 0, 10, vec![66])]);
    for schema in [1, 2] {
        let mut a = ready();
        let mut b = ready();
        let guards = [guard(true, false, false)];
        let ra = apply_schema_bytes(&mut a, &one, &guards, &[], schema).unwrap();
        let rb = apply_schema_bytes(&mut b, &two, &guards, &[], schema).unwrap();
        assert_eq!(ra.schema(), schema);
        assert_eq!(ra.events(), rb.events());
        assert_eq!(ra.frame_report(), rb.frame_report());
        assert_eq!(ra.setup_draws(), 0);
        assert_eq!(a, b);
        if schema == 1 {
            assert_eq!(ra, rb);
            assert!(ra.leaderboard_rows().is_empty());
        } else {
            assert_ne!(ra, rb);
            let ba = &ra.leaderboard_rows()[0];
            let bb = &rb.leaderboard_rows()[0];
            assert_eq!(ba.command_index(), 0);
            assert_eq!(ba.rows()[0].name(), [65]);
            assert_eq!(bb.rows()[0].name(), [66]);
            let arow = &ba.rows()[0];
            let brow = &bb.rows()[0];
            assert_eq!(arow.ordinal(), brow.ordinal());
            assert_eq!(arow.count(), brow.count());
            assert_eq!(
                arow.fractional_mass().to_bits(),
                brow.fractional_mass().to_bits()
            );
            assert_eq!(arow.raw_color(), brow.raw_color());
            assert_eq!(arow.palette_index(), brow.palette_index());
        }
    }
}

#[test]
fn raw_rows_preserve_every_byte_maximal_names_counts_colors_and_exact_f64() {
    let numerators = [0, 1, 8_388_608, 16_777_214, 16_777_215];
    let mut rows = Vec::new();
    for byte in 0..=u8::MAX {
        rows.push((
            u16::MAX,
            numerators[usize::from(byte) % numerators.len()],
            byte,
            vec![byte],
        ));
    }
    rows.push((0, 0, 0, vec![]));
    rows.push((u16::MAX, 16_777_215, u8::MAX, (0..u8::MAX).collect()));
    let mut bytes = raw_board(&rows);
    let mut c = ready();
    let report = apply_schema_bytes(&mut c, &bytes, &[guard(true, true, true)], &[], 2).unwrap();
    bytes.fill(0);
    assert_eq!(report.leaderboard_rows().len(), 1);
    let board = &report.leaderboard_rows()[0];
    assert_eq!(board.rows().len(), rows.len());
    for (index, (row, expected)) in board.rows().iter().zip(rows.iter()).enumerate() {
        assert_eq!(row.ordinal(), u32::try_from(index + 1).unwrap());
        assert_eq!(row.count(), expected.0);
        assert_eq!(
            row.fractional_mass().to_bits(),
            (f64::from(expected.1) / 16777215.0).to_bits()
        );
        assert_eq!(row.raw_color(), expected.2);
        assert_eq!(row.palette_index(), expected.2 % 9);
        assert_eq!(row.name(), expected.3);
    }
    assert!(matches!(
        report.events()[0].kind,
        Kind::Leaderboard {
            death_pending: true,
            ..
        }
    ));
    let saved = report.clone();
    c.reset();
    assert_eq!(report, saved);
    fn require_copy<T: Copy>() {}
    require_copy::<slither_client::presentation::HudIngressEvent>();
    require_copy::<Kind>();
}

#[test]
fn repeated_empty_and_ignored_boards_follow_original_command_indices_and_only_playing() {
    let board = raw_board(&[(4, 1, 255, vec![0, 255])]);
    let empty_board = raw_board(&[]);
    let commands = [
        vec![b'm'],
        board.clone(),
        board.clone(),
        empty_board.clone(),
        vec![b'p'],
        board.clone(),
        empty_board,
        board,
    ];
    let mut guards = [guard(true, true, true); 8];
    guards[5].playing = false;
    let mut c = ready();
    let report = apply_schema_bytes(&mut c, &bundle(&commands), &guards, &[], 2).unwrap();
    let boards = report.leaderboard_rows();
    assert_eq!(
        boards.iter().map(|b| b.command_index()).collect::<Vec<_>>(),
        [1, 2, 3, 6, 7]
    );
    assert_eq!(boards[0].rows(), boards[1].rows());
    assert!(boards[2].rows().is_empty());
    assert!(boards[3].rows().is_empty());
    let headers = report
        .events()
        .iter()
        .filter_map(|e| matches!(e.kind, Kind::Leaderboard { .. }).then_some(e.command_index))
        .collect::<Vec<_>>();
    assert_eq!(headers, [1, 2, 3, 6, 7]);
    assert_eq!(
        report.frame_report(),
        FrameReport {
            commands: 8,
            ignored: 2
        }
    );
    assert_eq!(report.setup_draws(), 0);
    assert_eq!(c.draw_serial(), 0);
}

#[test]
fn maximum_bare_board_is_not_capped_at_ten_or_4096_and_next_byte_rolls_back() {
    use slither_client::protocol::{MAX_FRAME_BYTES, ProtocolError};
    let count = (MAX_FRAME_BYTES - 6) / 7;
    assert_eq!(count, 149_795);
    let mut bytes = vec![b'l', 255, 255, 255, 0, 0];
    for _ in 0..count {
        bytes.extend([255, 255, 255, 255, 255, 255, 0]);
    }
    // Five bytes remain at the exact 1 MiB frame bound; keep a complete last name.
    *bytes.last_mut().unwrap() = 5;
    bytes.extend([0, 127, 128, 254, 255]);
    assert_eq!(bytes.len(), MAX_FRAME_BYTES);
    let mut c = ready();
    let guards = [guard(true, false, false)];
    let report = apply_schema_bytes(&mut c, &bytes, &guards, &[], 2).unwrap();
    let rows = report.leaderboard_rows()[0].rows();
    assert_eq!(rows.len(), count);
    assert_eq!(rows.last().unwrap().ordinal(), 149_795);
    assert_eq!(rows.last().unwrap().name(), [0, 127, 128, 254, 255]);
    assert_eq!(rows[4096].count(), u16::MAX);
    assert_eq!(rows[4096].fractional_mass().to_bits(), 1_f64.to_bits());
    assert_eq!(rows[4096].raw_color(), 255);
    let before = c.clone();
    bytes.push(0);
    assert_eq!(
        apply_schema_bytes(&mut c, &bytes, &guards, &[], 2),
        Err(ClientPresentationError::State(StateError::Protocol(
            ProtocolError::FrameTooLarge
        )))
    );
    assert_eq!(c, before);
}

#[test]
fn aggregate_boards_fill_a_legal_frame_and_maximum_empty_board_count_is_retained() {
    use slither_client::protocol::MAX_FRAME_BYTES;
    let mut remaining = MAX_FRAME_BYTES;
    let mut commands = Vec::new();
    let mut expected_rows = 0;
    while remaining != 0 {
        // Bundled two-byte length prefixes must remain below 32.
        let size = (remaining - 2).min(8191);
        let row_count = (size - 6) / 7;
        let padding = (size - 6) % 7;
        let mut board = raw_board(&vec![(u16::MAX, 1, 255, vec![]); row_count]);
        *board.last_mut().unwrap() = u8::try_from(padding).unwrap();
        board.extend(std::iter::repeat_n(255, padding));
        assert_eq!(board.len(), size);
        remaining -= size + 2;
        expected_rows += row_count;
        commands.push(board);
    }
    let bytes = bundle(&commands);
    assert_eq!(bytes.len(), MAX_FRAME_BYTES);
    let mut c = ready();
    let report = apply_schema_bytes(
        &mut c,
        &bytes,
        &vec![guard(true, false, false); commands.len()],
        &[],
        2,
    )
    .unwrap();
    let boards = report.leaderboard_rows();
    assert_eq!(boards.len(), commands.len());
    assert_eq!(
        boards.iter().map(|b| b.rows().len()).sum::<usize>(),
        expected_rows
    );
    for (i, board) in boards.iter().enumerate() {
        assert_eq!(board.command_index(), i);
        assert_eq!(board.rows()[0].ordinal(), 1);
        assert_eq!(
            board.rows()[0].fractional_mass().to_bits(),
            (1_f64 / 16777215.0).to_bits()
        );
    }
    let commands = vec![raw_board(&[]); MAX_FRAME_COMMANDS];
    let report = apply_schema_bytes(
        &mut c,
        &bundle(&commands),
        &vec![guard(true, true, true); MAX_FRAME_COMMANDS],
        &[],
        2,
    )
    .unwrap();
    assert_eq!(report.leaderboard_rows().len(), MAX_FRAME_COMMANDS);
    assert!(
        report
            .leaderboard_rows()
            .iter()
            .all(|b| b.rows().is_empty())
    );
    assert_eq!(report.events().len(), MAX_FRAME_COMMANDS);
}

#[test]
fn row_history_survives_setup_r_final_removal_death_and_wire_id_reuse() {
    for died in [false, true] {
        let mut legacy = ready();
        let mut c = legacy.clone();
        let token = c.own_token().unwrap();
        let first = raw_board(&[(u16::MAX, 16_777_215, 255, vec![255; 255])]);
        let second = raw_board(&[(0, 1, 0, vec![])]);
        let commands = [
            first,
            vec![b'R', 9],
            vec![b'v', 1],
            setup(29),
            second,
            vec![b's', 0, 7, u8::from(died)],
            appearance(7, 5),
            mass(7, 0),
            vec![b'R', 3],
            vec![b'v', 1],
            raw_board(&[]),
        ];
        let guards = [guard(true, false, true); 11];
        let bytes = bundle(&commands);
        let legacy_report = apply_schema_bytes(&mut legacy, &bytes, &guards, &[2, 9], 1).unwrap();
        let report = apply_schema_bytes(&mut c, &bytes, &guards, &[2, 9], 2).unwrap();
        assert_eq!(c, legacy);
        assert_eq!(report.events(), legacy_report.events());
        assert_eq!(report.frame_report(), legacy_report.frame_report());
        assert_eq!(report.setup_draws(), 1);
        assert_eq!(c.own_token(), Some(token));
        assert_eq!(
            finals(&report).iter().map(|(i, _)| *i).collect::<Vec<_>>(),
            [2, 9]
        );
        assert_eq!(finals(&report)[0].1.own.unwrap().score_adjustment, 9);
        assert_eq!(finals(&report)[1].1.own.unwrap().score_adjustment, 3);
        assert_eq!(finals(&report)[0].1.table_max, Some(17));
        assert_eq!(finals(&report)[1].1.table_max, Some(29));
        assert!(schedules(&report).is_empty());
        let boards = report.leaderboard_rows();
        assert_eq!(
            boards.iter().map(|b| b.command_index()).collect::<Vec<_>>(),
            [0, 4, 10]
        );
        assert_eq!(boards[0].rows()[0].count(), u16::MAX);
        assert_eq!(boards[0].rows()[0].name(), vec![255; 255]);
        assert_eq!(
            boards[1].rows()[0].fractional_mass().to_bits(),
            (1_f64 / 16777215.0).to_bits()
        );
        assert!(boards[2].rows().is_empty());
        let saved = report.clone();
        for step in 1..=200 {
            c.advance(f64::from(step * 40), false).unwrap();
        }
        c.reset();
        assert_eq!(report, saved);
    }
}

#[test]
fn schema_two_validates_false_playing_tails_and_late_supported_errors_before_callbacks() {
    let good = raw_board(&[(4, 0, 10, vec![65])]);
    let mut bad = good.clone();
    bad.pop();
    for playing in [false, true] {
        for tail in [
            bad.clone(),
            vec![b'h'],
            vec![b'R'],
            vec![b'f'],
            vec![b'y', 0, 31, 9],
        ] {
            let mut c = ready();
            let before = c.clone();
            let commands = [
                setup(29),
                good.clone(),
                appearance(8, 3),
                vec![b'f', 1, 2, 8, 9, 5],
                prey(),
                tail.clone(),
            ];
            let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
                &bundle(&commands), ElapsedHeader::Absent,
                |_| panic!("appearance before complete received validation"),
                |_, _| panic!("food before complete received validation"),
                |_, _| panic!("prey before complete received validation"),
                |_, _| panic!("setup before complete received validation"),
                HudIngressPlan { schema: 2, ..plan(&[guard(playing, true, true); 6], &[]) });
            if tail[0] == b'l' {
                assert!(matches!(
                    result,
                    Err(ClientPresentationError::State(StateError::Hud(
                        HudIngressError::Leaderboard(_)
                    )))
                ));
            } else {
                assert_eq!(
                    result,
                    Err(ClientPresentationError::State(StateError::InvalidPacket(
                        tail[0]
                    )))
                );
            }
            assert_eq!(c, before);
        }
    }
    let mut c = ready();
    let report = apply_schema_bytes(&mut c, &good, &[guard(false, true, true)], &[], 2).unwrap();
    assert!(report.events().is_empty());
    assert!(report.leaderboard_rows().is_empty());
    let mut no_tracking = AnimatedClient::new(0.).unwrap();
    let before = no_tracking.clone();
    assert_eq!(
        apply_schema_bytes(
            &mut no_tracking,
            &good,
            &[guard(true, false, false)],
            &[],
            2
        ),
        Err(ClientPresentationError::ScoreTrackingRequired)
    );
    assert_eq!(no_tracking, before);
}

#[test]
fn schema_two_late_source_and_setup_failures_discard_rows_and_preserve_client() {
    for failure in ["appearance", "food", "prey", "setup"] {
        let mut c = ready();
        let before = c.clone();
        let calls = RefCell::new(Vec::new());
        let commands = [
            raw_board(&[(4, 1, 255, vec![0, 255])]),
            appearance(8, 3),
            vec![b'f', 1, 2, 8, 9, 5],
            prey(),
            setup(29),
        ];
        let result = c.apply_frame_with_face_presentation_and_all_factories_and_setup_and_hud::<ClientPresentationError, _, _, _, _>(
            &bundle(&commands), ElapsedHeader::Absent,
            |_| { calls.borrow_mut().push("appearance"); if failure == "appearance" { Err(ClientPresentationError::Limit) } else { Ok(FacePresentation::default()) } },
            |p, _| { calls.borrow_mut().push("food"); if failure == "food" { Err(ClientPresentationError::Limit) } else { Ok(food_factory(p.raw_color)) } },
            |p, _| { calls.borrow_mut().push("prey"); if failure == "prey" { Err(ClientPresentationError::Limit) } else { Ok(prey_factory(p.raw_color)) } },
            |_, _| { calls.borrow_mut().push("setup"); Err(ClientPresentationError::Limit) },
            HudIngressPlan { schema: 2, ..plan(&[guard(true, false, true); 5], &[]) });
        assert_eq!(result, Err(ClientPresentationError::Limit));
        assert_eq!(c, before);
        let expected = ["appearance", "food", "prey", "setup"];
        let end = expected.iter().position(|name| *name == failure).unwrap();
        assert_eq!(*calls.borrow(), expected[..=end]);
    }
}
