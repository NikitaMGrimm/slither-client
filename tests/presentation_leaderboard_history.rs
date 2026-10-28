//! Authored native regressions for the existing schema-2 board/history/view contract.

use slither_client::presentation::{
    LeaderboardEvent as Event, LeaderboardEventKind as Kind, LeaderboardHistory as History,
    LeaderboardRawRow as RawRow,
};

fn row(name: &[u8]) -> RawRow {
    RawRow {
        count: 2,
        fractional_mass: 0.5,
        raw_color: 0,
        name: name.to_vec(),
    }
}
fn setup(index: usize, maximum: u16) -> Event {
    Event {
        command_index: index,
        kind: Kind::Setup(maximum),
    }
}
fn board(index: usize, local_row: u8, rows: Vec<RawRow>) -> Event {
    Event {
        command_index: index,
        kind: Kind::Board { local_row, rows },
    }
}
fn complete(history: &History, events: &[Event], scores: &[Vec<f64>], name: &str) -> History {
    let mut plan = history.prepare(events).unwrap();
    plan.begin().unwrap();
    let next = history.stage_complete(&mut plan, scores, name).unwrap();
    next.commit().unwrap();
    next
}
fn shown() -> History {
    complete(
        &History::default(),
        &[setup(0, 3), board(1, 0, vec![row(b"A")])],
        &[vec![42.]],
        "Local",
    )
}

#[test]
fn initial_no_setup_no_board_and_empty_packet_are_distinct_from_accepted_empty_board() {
    let initial = History::default();
    assert!(initial.is_open());
    assert_eq!(initial.table_max(), None);
    assert!(!initial.setup_seen());
    assert_eq!(initial.revision().decimal(), "0");
    assert_eq!(initial.board(), None);
    assert_eq!(initial.view(0., 0.).readiness, "pending");
    assert_eq!(initial.view(0., 0.).reason, Some("no-board"));
    let empty = complete(&initial, &[], &[], "");
    assert_eq!(empty.table_max(), None);
    assert_eq!(empty.board(), None);
    assert!(!initial.is_open());
    let board = complete(&empty, &[setup(0, 1), board(1, 0, vec![])], &[vec![]], "");
    assert_eq!(board.board(), Some([].as_slice()));
    assert_eq!(board.revision().decimal(), "1");
    assert!(board.visible_rows().is_empty());
    assert_eq!(board.view(-0.85, -1.).readiness, "ready");
    assert_eq!(board.view(-0.85, -1.).reason, None);
    assert_eq!(board.view(-0.85, -1.).heading_opacity, -0.85);
    assert_eq!(board.view(-0.85, -1.).row_opacity, -1.);
}

#[test]
fn requests_use_command_time_tables_while_later_setup_replaces_only_table_history() {
    let history = complete(&History::default(), &[setup(0, 1)], &[], "");
    let events = [
        board(
            0,
            0,
            vec![RawRow {
                count: 0,
                fractional_mass: 0.,
                ..row(b"A")
            }],
        ),
        setup(1, 4),
        board(2, 0, vec![]),
        setup(3, 7),
    ];
    let mut plan = history.prepare(&events).unwrap();
    assert_eq!(plan.requests().len(), 2);
    assert_eq!(
        (
            plan.requests()[0].command_index,
            plan.requests()[0].table_max
        ),
        (0, 1)
    );
    assert_eq!(plan.requests()[0].counts, [0]);
    assert_eq!(plan.requests()[0].fractional_masses, [0.]);
    assert_eq!(
        (
            plan.requests()[1].command_index,
            plan.requests()[1].table_max
        ),
        (2, 4)
    );
    plan.begin().unwrap();
    let next = history
        .stage_complete(&mut plan, &[vec![-20.], vec![]], "")
        .unwrap();
    assert!(history.is_open());
    assert!(!next.is_open());
    assert_eq!(next.table_max(), Some(7));
    assert_eq!(next.revision().decimal(), "2");
    assert!(next.board().unwrap().is_empty());
    next.commit().unwrap();
    let final_board = complete(&next, &[board(0, 0, vec![row(b"Last")])], &[vec![91.]], "");
    assert_eq!(final_board.table_max(), Some(7));
    assert_eq!(final_board.board().unwrap()[0].score, 91.);
}

#[test]
fn whole_journal_validation_is_atomic_and_requires_prior_setup() {
    let history = History::default();
    for events in [
        vec![board(0, 0, vec![]), setup(1, 3)],
        vec![setup(0, 0)],
        vec![setup(0, 3), board(0, 0, vec![])],
        vec![setup(4096, 3)],
        vec![
            setup(0, 3),
            board(
                1,
                0,
                vec![RawRow {
                    fractional_mass: f64::NAN,
                    ..row(b"A")
                }],
            ),
        ],
        vec![setup(0, 3), board(1, 0, vec![row(&[0; 256])])],
    ] {
        assert!(history.prepare(&events).is_err());
        assert!(history.is_open());
        assert_eq!(history.table_max(), None);
    }
    for fractional_mass in [-0.01, 1.01, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(
            history
                .prepare(&[
                    setup(0, 3),
                    board(
                        1,
                        0,
                        vec![RawRow {
                            fractional_mass,
                            ..row(b"A")
                        }]
                    )
                ])
                .is_err()
        );
    }
}

#[test]
fn prepared_operations_are_one_use_and_bound_to_the_exact_native_owner() {
    let history = History::default();
    let other = History::default();
    let events = [setup(0, 3), board(1, 0, vec![row(b"A")])];
    let mut plan = history.prepare(&events).unwrap();
    assert!(history.stage_complete(&mut plan, &[vec![0.]], "").is_err());
    plan.begin().unwrap();
    assert!(plan.begin().is_err());
    assert!(other.stage_complete(&mut plan, &[vec![0.]], "").is_err());
    let mut stale = history.prepare(&events).unwrap();
    stale.begin().unwrap();
    let next = history.stage_complete(&mut plan, &[vec![0.]], "").unwrap();
    assert!(history.stage_complete(&mut plan, &[vec![0.]], "").is_err());
    next.commit().unwrap();
    assert!(next.commit().is_err());
    assert!(history.stage_complete(&mut stale, &[vec![0.]], "").is_err());
    assert!(history.prepare(&events).is_err());
    assert_eq!(history.board(), None);
}

#[test]
fn failed_completion_consumes_only_its_plan_and_dropped_candidates_leave_history_open() {
    for results in [
        vec![],
        vec![vec![]],
        vec![vec![0., 1.]],
        vec![vec![f64::NAN]],
        vec![vec![1.5]],
    ] {
        let history = History::default();
        let events = [setup(0, 3), board(1, 0, vec![row(b"A")])];
        let mut plan = history.prepare(&events).unwrap();
        plan.begin().unwrap();
        assert!(history.stage_complete(&mut plan, &results, "").is_err());
        assert!(history.stage_complete(&mut plan, &[vec![0.]], "").is_err());
        assert!(history.is_open());
        assert_eq!(history.board(), None);
        let mut valid = history.prepare(&events).unwrap();
        valid.begin().unwrap();
        let candidate = history.stage_complete(&mut valid, &[vec![1.]], "").unwrap();
        drop(candidate);
        assert!(history.is_open());
        assert_eq!(
            complete(&history, &events, &[vec![2.]], "")
                .board()
                .unwrap()[0]
                .score,
            2.
        );
    }
}

#[test]
fn setup_and_reset_preserve_board_identity_revision_and_displayed_names_without_rescoring() {
    let history = shown();
    let setup_only = complete(&history, &[setup(0, 65000)], &[], "Second");
    assert!(history.shares_board(&setup_only));
    assert_eq!(setup_only.revision().decimal(), "1");
    assert_eq!(setup_only.board().unwrap()[0].name_text, "A");
    let mut pending = setup_only.prepare(&[board(0, 0, vec![])]).unwrap();
    pending.begin().unwrap();
    let reset = setup_only.stage_reset().unwrap();
    assert!(setup_only.is_open());
    assert!(setup_only.shares_board(&reset));
    reset.commit().unwrap();
    assert!(
        setup_only
            .stage_complete(&mut pending, &[vec![]], "")
            .is_err()
    );
    assert_eq!(reset.table_max(), Some(65000));
    assert!(reset.setup_seen());
    assert_eq!(reset.revision().decimal(), "1");
    let equal = complete(&reset, &[board(0, 0, vec![row(b"A")])], &[vec![42.]], "");
    assert!(!equal.shares_board(&reset));
    assert_eq!(equal.revision().decimal(), "2");
}

#[test]
fn all_original_rows_colors_marker_positions_and_raw_opacity_are_preserved() {
    let rows: Vec<_> = (0..=255)
        .map(|color| RawRow {
            raw_color: color,
            ..row(b"A")
        })
        .collect();
    for local_row in [0, 1, 255] {
        let state = complete(
            &History::default(),
            &[setup(0, 3), board(1, local_row, rows.clone())],
            &[vec![0.; 256]],
            "Own",
        );
        let displayed = state.board().unwrap();
        assert_eq!(displayed.len(), 256);
        assert_eq!(state.visible_rows().len(), 10);
        assert_eq!(displayed[255].number_text, "#256");
        assert_eq!(displayed[255].css_color, "#80ff80");
        for (index, value) in displayed.iter().enumerate() {
            let own = index + 1 == usize::from(local_row);
            assert_eq!(value.own, own);
            assert_eq!(value.ordinal, index + 1);
            assert_eq!(
                value.opacity_request,
                if own {
                    1.
                } else {
                    0.7 * (0.3 + 0.7 * (1. - (index + 1) as f64 / 10.))
                }
            );
        }
        assert!(displayed[14].opacity_request < 0.);
    }
}

#[test]
fn latin1_bytes_normalization_and_literal_text_are_exact() {
    let rows: Vec<_> = (0..=255).map(|unit| row(&[unit])).collect();
    let state = complete(
        &History::default(),
        &[setup(0, 3), board(1, 0, rows)],
        &[vec![0.; 256]],
        "",
    );
    for unit in 0..=255 {
        let expected = match unit {
            0 => String::new(),
            13 => "\n".into(),
            32 => "\u{a0}".into(),
            _ => char::from(unit).to_string(),
        };
        assert_eq!(
            state.board().unwrap()[usize::from(unit)].name_text,
            expected
        );
    }
    let names = [
        b"A\r\nB\rC\0\x01\xa0\t".as_slice(),
        b"A&<>\"' &amp;  ",
        b"\\u0041&#65;",
        &[255; 255],
    ];
    let expected = [
        "A\nB\nC\u{1}\u{a0}\t".into(),
        "A&<>\"'\u{a0}&amp;\u{a0}\u{a0}".into(),
        "\\u0041&#65;".into(),
        "\u{ff}".repeat(255),
    ];
    let state = complete(
        &History::default(),
        &[
            setup(0, 3),
            board(1, 0, names.iter().map(|name| row(name)).collect()),
        ],
        &[vec![0.; 4]],
        "",
    );
    assert_eq!(
        state
            .board()
            .unwrap()
            .iter()
            .map(|row| row.name_text.clone())
            .collect::<Vec<_>>(),
        expected
    );
}

#[test]
fn seven_digit_filter_only_resets_on_ascii_letters_and_own_substitution_bypasses_it() {
    let names = [
        b"123456".as_slice(),
        b"1.2 3-4!5?6",
        b"1234567",
        b"123456A7",
        b"123456z7",
        b"123456\xff7",
        b"123456\r7",
    ];
    let state = complete(
        &History::default(),
        &[
            setup(0, 3),
            board(1, 0, names.iter().map(|name| row(name)).collect()),
        ],
        &[vec![0.; 7]],
        "",
    );
    assert_eq!(
        state
            .board()
            .unwrap()
            .iter()
            .map(|row| row.name_text.as_str())
            .collect::<Vec<_>>(),
        [
            "123456",
            "1.2\u{a0}3-4!5?6",
            "",
            "123456A7",
            "123456z7",
            "",
            ""
        ]
    );
    let own = complete(
        &History::default(),
        &[setup(0, 3), board(1, 1, vec![row(b"1234567")])],
        &[vec![0.]],
        "1234567 A&<>\x7f",
    );
    assert_eq!(own.board().unwrap()[0].name_text, "1234567\u{a0}A&<>\x7f");
    for name in ["X".repeat(25), "\0".into(), "\r".into(), "\u{80}".into()] {
        let initial = History::default();
        let mut plan = initial.prepare(&[]).unwrap();
        plan.begin().unwrap();
        assert!(initial.stage_complete(&mut plan, &[], &name).is_err());
    }
}

#[test]
fn safe_score_text_signed_zero_and_inclusive_table_plateau_are_unchanged() {
    let values = [-0., -20., 4_294_967_297., 9_007_199_254_740_991., f64::NAN];
    let rows = values
        .iter()
        .enumerate()
        .map(|(index, _)| RawRow {
            count: if index == 4 { 2052 } else { 2051 },
            ..row(b"A")
        })
        .collect();
    let state = complete(
        &History::default(),
        &[setup(0, 3), board(1, 0, rows)],
        &[values.to_vec()],
        "",
    );
    let rows = state.board().unwrap();
    assert_eq!(rows[0].score.to_bits(), (-0_f64).to_bits());
    assert_eq!(
        rows.iter()
            .map(|row| row.score_text.as_str())
            .collect::<Vec<_>>(),
        ["0", "-20", "4294967297", "9007199254740991", "NaN"]
    );
    for (count, score) in [
        (2051, f64::NAN),
        (2052, 0.),
        (0, f64::INFINITY),
        (0, 1.5),
        (0, 9_007_199_254_740_992.),
    ] {
        let history = History::default();
        let mut plan = history
            .prepare(&[
                setup(0, 3),
                board(1, 0, vec![RawRow { count, ..row(b"A") }]),
            ])
            .unwrap();
        plan.begin().unwrap();
        assert!(
            history
                .stage_complete(&mut plan, &[vec![score]], "")
                .is_err()
        );
    }
    let maximum = complete(
        &History::default(),
        &[
            setup(0, u16::MAX),
            board(
                1,
                0,
                vec![RawRow {
                    count: u16::MAX,
                    fractional_mass: 1.,
                    ..row(b"A")
                }],
            ),
        ],
        &[vec![1.]],
        "",
    );
    assert_eq!(maximum.board().unwrap()[0].score, 1.);
}

#[test]
fn maximum_boards_rows_and_aggregate_wire_budgets_are_admitted_at_the_boundary() {
    let setup_only = complete(&History::default(), &[setup(0, 1)], &[], "");
    let events: Vec<_> = (0..4096).map(|index| board(index, 0, vec![])).collect();
    let state = complete(&setup_only, &events, &vec![vec![]; 4096], "");
    assert_eq!(state.revision().decimal(), "4096");
    let rows = vec![row(b""); 149795];
    let history = History::default();
    let plan = history
        .prepare(&[setup(0, 3), board(1, 0, rows.clone())])
        .unwrap();
    assert_eq!(plan.requests()[0].counts.len(), 149795);
    assert!(
        history
            .prepare(&[setup(0, 3), board(1, 0, rows.clone()), board(2, 0, vec![])])
            .is_err()
    );
    let mut too_many = rows;
    too_many.push(row(b""));
    assert!(
        history
            .prepare(&[setup(0, 3), board(1, 0, too_many)])
            .is_err()
    );
    let mut exact_bytes = vec![row(&[255; 255]); 4002];
    exact_bytes.push(row(&[255; 39]));
    assert!(
        history
            .prepare(&[setup(0, 3), board(1, 0, exact_bytes.clone())])
            .is_ok()
    );
    exact_bytes[4002].name.push(255);
    assert!(
        history
            .prepare(&[setup(0, 3), board(1, 0, exact_bytes)])
            .is_err()
    );
}
