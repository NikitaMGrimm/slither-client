//! Authored synthetic inputs using the exact new module and actual native tables.
//! No numerical double or external reference; native powf is not browser authority.

use slither_client::presentation::{
    LeaderboardRowScore, LeaderboardScoreError, LeaderboardScoreInput, LeaderboardScoreProjector,
    ScoreError, ScoreTables,
};

fn row(count: u16, fractional_mass: f64) -> LeaderboardScoreInput {
    LeaderboardScoreInput {
        count,
        fractional_mass,
    }
}

fn value_bits(score: LeaderboardRowScore) -> u64 {
    match score {
        LeaderboardRowScore::Value(value) => value.to_bits(),
        LeaderboardRowScore::OutOfTable => panic!("expected numeric score"),
    }
}

#[test]
fn analytic_unit_scores_preserve_order_negative_zero_mass_and_fractional_floor() {
    let cases = [
        (0, 0., -20_f64),
        (0, -0., -20.),
        (0, 1., -5.),
        (0, 0.5, -13.),
        (1, 0., -5.),
        (1, 1., 10.),
        (1, 1. / 3., -1.),
        (1, 1. / 16_777_215., -5.),
        (1, 8_388_607. / 16_777_215., 2.),
    ];
    let rows: Vec<_> = cases
        .iter()
        .map(|&(count, mass, _)| row(count, mass))
        .collect();
    let scores = LeaderboardScoreProjector::new().project(1, &rows).unwrap();
    for (score, &(_, _, expected)) in scores.into_iter().zip(&cases) {
        assert_eq!(value_bits(score), expected.to_bits());
    }
}

#[test]
fn endpoint_plateau_and_first_unsupported_raw_count_are_distinct() {
    let mut projector = LeaderboardScoreProjector::new();
    let rows: Vec<_> = (1..=2049).map(|count| row(count, 1.)).collect();
    assert!(
        projector
            .project(1, &rows)
            .unwrap()
            .iter()
            .all(|&score| value_bits(score) == 10_f64.to_bits())
    );
    assert_eq!(
        projector
            .project(1, &[row(2050, 0.), row(u16::MAX, 1.)])
            .unwrap(),
        [
            LeaderboardRowScore::OutOfTable,
            LeaderboardRowScore::OutOfTable
        ]
    );
}

#[test]
fn raw_u16_count_is_not_capped_or_adjusted_and_wide_f64_is_retained() {
    let mut projector = LeaderboardScoreProjector::new();
    let tables = ScoreTables::new(u16::MAX).unwrap();
    let rows = [
        row(0, 0.),
        row(4096, 0.5),
        row(4097, 0.5),
        row(u16::MAX, 1.),
    ];
    let scores = projector.project(u16::MAX, &rows).unwrap();
    for (&score, input) in scores.iter().zip(&rows) {
        assert_eq!(
            value_bits(score),
            tables
                .score(usize::from(input.count), input.fractional_mass)
                .unwrap()
                .to_bits()
        );
    }
    assert_ne!(scores[1], scores[2]);
    let LeaderboardRowScore::Value(wide) = scores[3] else {
        panic!("wide score")
    };
    assert!(wide > f64::from(u32::MAX));
    assert!(wide.is_finite());
    assert_eq!(wide.fract(), 0.);
    assert_eq!(scores[0], LeaderboardRowScore::Value(-20.));
}

#[test]
fn validation_covers_every_mass_even_for_out_of_table_rows_and_preserves_cache() {
    let mut projector = LeaderboardScoreProjector::new();
    projector.project(1, &[]).unwrap();
    assert_eq!(
        projector.project(0, &[]),
        Err(LeaderboardScoreError::Score(ScoreError::ZeroTableMax))
    );
    for mass in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -f64::MIN_POSITIVE,
        1_f64.next_up(),
    ] {
        assert_eq!(
            projector.project(2, &[row(1, 0.), row(u16::MAX, mass)]),
            Err(LeaderboardScoreError::Score(
                ScoreError::InvalidFractionalMass
            ))
        );
        assert_eq!(
            projector.project(1, &[row(2050, 1.)]).unwrap(),
            [LeaderboardRowScore::OutOfTable]
        );
    }
    assert!(
        projector
            .project(1, &[row(0, 0_f64.next_up()), row(1, 1_f64.next_down())])
            .is_ok()
    );
}

#[test]
fn changed_parameter_empty_batch_and_copied_results_have_independent_ownership() {
    let mut projector = LeaderboardScoreProjector::new();
    let inputs = [row(2050, 1.), row(1, 0.)];
    let old = projector.project(1, &inputs).unwrap();
    assert_eq!(
        old,
        [
            LeaderboardRowScore::OutOfTable,
            LeaderboardRowScore::Value(-5.)
        ]
    );
    assert!(projector.project(2, &[]).unwrap().is_empty());
    let changed = projector.project(2, &inputs).unwrap();
    assert!(matches!(changed[0], LeaderboardRowScore::Value(_)));
    let mut same = projector.project(2, &inputs).unwrap();
    assert_eq!(same, changed);
    same[0] = LeaderboardRowScore::OutOfTable;
    assert_eq!(projector.project(2, &inputs).unwrap(), changed);
    assert_eq!(old[0], LeaderboardRowScore::OutOfTable);
    assert_eq!(projector.project(1, &inputs).unwrap(), old);
}

#[test]
fn maximum_row_batch_is_complete_and_next_length_is_rejected() {
    let mut projector = LeaderboardScoreProjector::new();
    let mut rows = vec![row(1, 1.); 149_795];
    let scores = projector.project(1, &rows).unwrap();
    assert_eq!(scores.len(), rows.len());
    assert!(
        scores
            .iter()
            .all(|score| *score == LeaderboardRowScore::Value(10.))
    );
    rows.push(row(1, 0.));
    assert_eq!(
        projector.project(2, &rows),
        Err(LeaderboardScoreError::TooManyRows)
    );
    assert_eq!(
        projector.project(1, &[row(2050, 1.)]).unwrap(),
        [LeaderboardRowScore::OutOfTable]
    );
}
