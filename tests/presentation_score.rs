//! Original synthetic native score cases; no external program or reference data.
//! Native powf expectations here do not establish any browser's Math.pow parity.

use slither_client::presentation::{ScoreError, ScoreTables};

#[test]
fn unit_parameter_scores_are_analytic_including_negatives_and_fractional_floor() {
    let tables = ScoreTables::new(1).unwrap();
    for (index, mass, expected) in [
        (0, 0., -20_f64),
        (0, -0., -20.),
        (0, 1., -5.),
        (0, 0.5, -13.),
        (1, 0., -5.),
        (1, 0.25, -2.),
        (1, 0.5, 2.),
        // Adding to P before subtracting one rounds below the simplified mass*15-5.
        (1, 1. / 3., -1.),
        (1, 1., 10.),
        (2, 0., -5.),
        (2049, 1., 10.),
    ] {
        assert_eq!(
            tables.score(index, mass).unwrap().to_bits(),
            expected.to_bits()
        );
    }
}

#[test]
fn plateau_scores_are_constant_through_the_last_legal_index() {
    for n in [1, 2, 17, 300] {
        let tables = ScoreTables::new(n).unwrap();
        let endpoint = usize::from(n);
        for mass in [0., 1. / 16_777_215., 0.5, 1.] {
            let expected = tables.score(endpoint, mass).unwrap();
            for index in endpoint + 1..=endpoint + 2048 {
                assert_eq!(
                    tables.score(index, mass).unwrap().to_bits(),
                    expected.to_bits()
                );
            }
        }
        assert_eq!(
            tables.score(endpoint + 2049, 0.),
            Err(ScoreError::IndexOutOfRange)
        );
        assert_eq!(
            tables.score(usize::MAX, 1.),
            Err(ScoreError::IndexOutOfRange)
        );
    }
}

#[test]
fn maximum_parameter_retains_finite_integer_scores_above_32_bits() {
    let tables = ScoreTables::new(u16::MAX).unwrap();
    let endpoint = usize::from(u16::MAX);
    for mass in [0., 0.5, 1.] {
        let score = tables.score(endpoint, mass).unwrap();
        assert!(score.is_finite());
        assert_eq!(score.fract(), 0.);
        assert!(score > f64::from(u32::MAX));
        assert!(score < 2_f64.powi(42));
        assert_eq!(
            tables.score(endpoint + 2048, mass).unwrap().to_bits(),
            score.to_bits()
        );
    }
}

#[test]
fn every_supported_index_accepts_both_mass_endpoints() {
    for n in [1, 2, u16::MAX] {
        let tables = ScoreTables::new(n).unwrap();
        for index in 0..=usize::from(n) + 2048 {
            for mass in [0., 1.] {
                let score = tables.score(index, mass).unwrap();
                assert!(score.is_finite());
                assert_eq!(score.fract(), 0.);
            }
        }
    }
}

#[test]
fn invalid_domains_are_explicit_and_leave_tables_unchanged() {
    assert_eq!(ScoreTables::new(0), Err(ScoreError::ZeroTableMax));
    let mut tables = ScoreTables::new(2).unwrap();
    let before = tables.clone();
    assert_eq!(tables.reconfigure(0), Err(ScoreError::ZeroTableMax));
    assert_eq!(tables, before);
    for mass in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -f64::MIN_POSITIVE,
        1_f64.next_up(),
    ] {
        assert_eq!(
            tables.score(0, mass),
            Err(ScoreError::InvalidFractionalMass)
        );
        assert_eq!(tables, before);
    }
    assert_eq!(tables.score(2051, 0.), Err(ScoreError::IndexOutOfRange));
    assert_eq!(tables, before);
    assert!(tables.score(0, 0_f64.next_up()).is_ok());
    assert!(tables.score(0, 1_f64.next_down()).is_ok());
}

#[test]
fn changed_parameter_replaces_the_bound_and_changed_back_restores_exact_values() {
    let mut tables = ScoreTables::new(1).unwrap();
    let original = tables.clone();
    tables.reconfigure(2).unwrap();
    assert_eq!(tables.table_max(), 2);
    assert_ne!(tables.score(2, 0.).unwrap().to_bits(), (-5_f64).to_bits());
    assert!(tables.score(2050, 1.).is_ok());
    tables.reconfigure(2).unwrap();
    assert_eq!(tables, ScoreTables::new(2).unwrap());
    tables.reconfigure(1).unwrap();
    assert_eq!(tables, original);
    assert_eq!(tables.score(2050, 1.), Err(ScoreError::IndexOutOfRange));
}
