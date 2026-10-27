//! Bounded score arithmetic, independent of body smoothing and world ownership.

use std::{error::Error, fmt};

use crate::math;

const PLATEAU_ENTRIES: usize = 2048;

/// An unsupported score-table parameter, fractional mass, or table index.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScoreError {
    /// The Setup table parameter must be positive.
    ZeroTableMax,
    /// Latest fractional mass must be finite and in 0 through 1 inclusive.
    InvalidFractionalMass,
    /// The index exceeds the final supported index, N + 2048.
    IndexOutOfRange,
}

impl fmt::Display for ScoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::ZeroTableMax => "score table parameter must be positive",
            Self::InvalidFractionalMass => "score fractional mass must be finite and in 0..=1",
            Self::IndexOutOfRange => "score index exceeds table bounds",
        })
    }
}

impl Error for ScoreError {}

/// Owned f64 score tables for one positive u16 Setup parameter N.
///
/// Both arrays plateau after N and end at N + 2048 inclusive. The parameter is
/// a score-table bound, not a physical body limit. Tables have no world/reset
/// lifecycle; the caller decides how long to retain this cache.
///
/// Exponentiation uses the existing host Math.pow seam on Wasm and native powf
/// elsewhere. Native results do not establish browser bit equality.
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreTables {
    table_max: u16,
    factors: Box<[f64]>,
    cumulative: Box<[f64]>,
}

impl ScoreTables {
    /// Build tables in increasing index order; reject N = 0 without a fallback.
    pub fn new(table_max: u16) -> Result<Self, ScoreError> {
        if table_max == 0 {
            return Err(ScoreError::ZeroTableMax);
        }
        let n = usize::from(table_max);
        let len = n + 1 + PLATEAU_ENTRIES;
        let mut factors = Vec::with_capacity(len);
        let mut cumulative = Vec::with_capacity(len);
        for index in 0..=n {
            let factor = if index < n {
                math::pow(1. - index as f64 / f64::from(table_max), 2.25)
            } else {
                factors[index - 1]
            };
            factors.push(factor);
            let sum = if index == 0 {
                0.
            } else {
                cumulative[index - 1] + 1. / factors[index - 1]
            };
            cumulative.push(sum);
        }
        // The endpoint advances the sum once; appended entries advance neither array.
        factors.resize(len, factors[n]);
        cumulative.resize(len, cumulative[n]);
        Ok(Self {
            table_max,
            factors: factors.into_boxed_slice(),
            cumulative: cumulative.into_boxed_slice(),
        })
    }

    /// Retain both allocations for equal N; otherwise replace both tables together.
    /// An invalid parameter leaves the existing cache unchanged.
    pub fn reconfigure(&mut self, table_max: u16) -> Result<(), ScoreError> {
        if table_max != self.table_max {
            *self = Self::new(table_max)?;
        }
        Ok(())
    }

    /// Positive Setup score-table parameter of the retained cache.
    pub fn table_max(&self) -> u16 {
        self.table_max
    }

    /// Score an already composed index and latest unsmoothed fractional mass.
    ///
    /// Admit indices 0 through N + 2048 inclusive and finite mass in 0..=1.
    /// Return an integer-valued f64, retaining negatives and values above 32 bits.
    /// The caller composes any own logical count and R adjustment before this call.
    /// Invalid input returns an error without clamping or changing the cache.
    pub fn score(&self, index: usize, fractional_mass: f64) -> Result<f64, ScoreError> {
        if !fractional_mass.is_finite() || !(0. ..=1.).contains(&fractional_mass) {
            return Err(ScoreError::InvalidFractionalMass);
        }
        let factor = self.factors.get(index).ok_or(ScoreError::IndexOutOfRange)?;
        // Keep the source's successive operations, including its final numeric division.
        let mass = fractional_mass / factor;
        let sum = self.cumulative[index] + mass;
        let reduced = sum - 1.;
        let scaled = reduced * 15.;
        let shifted = scaled - 5.;
        Ok(shifted.floor() / 1.)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analytic_unit_tables_have_exact_endpoint_and_both_plateaus() {
        let tables = ScoreTables::new(1).unwrap();
        assert_eq!(tables.factors.len(), 2050);
        assert_eq!(tables.cumulative.len(), 2050);
        assert!(
            tables
                .factors
                .iter()
                .all(|value| value.to_bits() == 1_f64.to_bits())
        );
        assert_eq!(tables.cumulative[0].to_bits(), 0_f64.to_bits());
        assert!(
            tables.cumulative[1..]
                .iter()
                .all(|value| value.to_bits() == 1_f64.to_bits())
        );
    }

    #[test]
    fn native_nontrivial_tables_use_previous_factor_and_advance_only_at_endpoint() {
        // N=2 has only one nontrivial powf factor; this is a native math witness.
        let tables = ScoreTables::new(2).unwrap();
        let factor = 0.5_f64.powf(2.25);
        let endpoint_sum = 1. + 1. / factor;
        assert_eq!(tables.factors.len(), 2051);
        assert_eq!(tables.cumulative.len(), 2051);
        assert_eq!(tables.factors[0].to_bits(), 1_f64.to_bits());
        assert_eq!(tables.factors[1].to_bits(), factor.to_bits());
        assert_eq!(tables.cumulative[1].to_bits(), 1_f64.to_bits());
        assert!(
            tables.factors[2..]
                .iter()
                .all(|value| value.to_bits() == factor.to_bits())
        );
        assert!(
            tables.cumulative[2..]
                .iter()
                .all(|value| value.to_bits() == endpoint_sum.to_bits())
        );
    }

    #[test]
    fn equal_parameter_reuses_allocations_and_clone_has_independent_ownership() {
        let mut tables = ScoreTables::new(2).unwrap();
        let factors = tables.factors.as_ptr();
        let cumulative = tables.cumulative.as_ptr();
        tables.reconfigure(2).unwrap();
        assert_eq!(tables.factors.as_ptr(), factors);
        assert_eq!(tables.cumulative.as_ptr(), cumulative);
        let mut cloned = tables.clone();
        assert_ne!(cloned.factors.as_ptr(), factors);
        assert_ne!(cloned.cumulative.as_ptr(), cumulative);
        cloned.reconfigure(1).unwrap();
        assert_eq!(tables.table_max(), 2);
        assert_eq!(tables.factors.as_ptr(), factors);
        assert_eq!(tables.cumulative.as_ptr(), cumulative);
    }

    #[test]
    fn maximum_tables_are_bounded_positive_and_finite() {
        let tables = ScoreTables::new(u16::MAX).unwrap();
        let n = usize::from(u16::MAX);
        assert_eq!(tables.factors.len(), n + 2049);
        assert_eq!(tables.cumulative.len(), n + 2049);
        assert!(
            tables
                .factors
                .iter()
                .all(|value| value.is_finite() && *value > 0.)
        );
        assert!(tables.cumulative.iter().all(|value| value.is_finite()));
        assert_eq!(tables.factors[n].to_bits(), tables.factors[n - 1].to_bits());
        assert_eq!(
            tables.cumulative[n].to_bits(),
            (tables.cumulative[n - 1] + 1. / tables.factors[n - 1]).to_bits()
        );
        assert!(
            tables.factors[n + 1..]
                .iter()
                .all(|value| value.to_bits() == tables.factors[n].to_bits())
        );
        assert!(
            tables.cumulative[n + 1..]
                .iter()
                .all(|value| value.to_bits() == tables.cumulative[n].to_bits())
        );
    }
}
