//! Transactional raw leaderboard scores, independent of own-body presentation.

use std::{error::Error, fmt};

use super::{ScoreError, ScoreTables};

const MAX_ROWS: usize = 149_795;

/// One raw row count and its latest unsmoothed fractional mass.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LeaderboardScoreInput {
    /// Unadjusted wire count, independent of own-body limits.
    pub count: u16,
    /// Decoded f64 mass in the inclusive range zero through one.
    pub fractional_mass: f64,
}

/// An integer-valued f64 score or an index beyond the selected table's plateau.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LeaderboardRowScore {
    /// Exact ordered score arithmetic, retaining signed zero and wide values.
    Value(f64),
    /// Raw count exceeds the selected table's final plateau index.
    OutOfTable,
}

/// Invalid numeric input, an oversized batch, or a recoverable output reservation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LeaderboardScoreError {
    /// Invalid table parameter or fractional mass.
    Score(ScoreError),
    /// The batch exceeds the complete-frame row bound.
    TooManyRows,
    /// Fallible output reservation failed before cache mutation.
    AllocationFailed,
}

impl fmt::Display for LeaderboardScoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Score(error) => error.fmt(f),
            Self::TooManyRows => f.write_str("leaderboard score batch exceeds 149795 rows"),
            Self::AllocationFailed => f.write_str("leaderboard score output reservation failed"),
        }
    }
}

impl Error for LeaderboardScoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Score(error) => Some(error),
            _ => None,
        }
    }
}

impl From<ScoreError> for LeaderboardScoreError {
    fn from(error: ScoreError) -> Self {
        Self::Score(error)
    }
}

/// Independently owned numeric cache with no scene or world-reset lifecycle.
///
/// Uses unchanged `ScoreTables` arithmetic, including its native powf / Wasm
/// host Math.pow seam. Native results do not establish browser bit equality.
/// Output reservations are fallible; existing `ScoreTables` allocations are not
/// recoverable on allocator exhaustion.
#[derive(Debug, Default)]
pub struct LeaderboardScoreProjector {
    tables: Option<ScoreTables>,
}

/// A disposable result and, only for changed N, the replacement cache.
#[derive(Debug)]
pub(crate) struct LeaderboardScoreProjection {
    scores: Vec<LeaderboardRowScore>,
    replacement: Option<ScoreTables>,
}

impl LeaderboardScoreProjection {
    // Production inspection is for Wasm conversion; native callers use project.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    pub(crate) fn scores(&self) -> &[LeaderboardRowScore] {
        &self.scores
    }
}

impl LeaderboardScoreProjector {
    /// Start without configured tables.
    pub fn new() -> Self {
        Self::default()
    }

    /// Validate and score the whole batch, then commit its selected table cache.
    /// Raw counts receive no own R adjustment, body recount or logical-body cap.
    pub fn project(
        &mut self,
        table_max: u16,
        rows: &[LeaderboardScoreInput],
    ) -> Result<Vec<LeaderboardRowScore>, LeaderboardScoreError> {
        let projection = self.prepare(table_max, rows)?;
        Ok(self.commit(projection))
    }

    /// Stage without mutation so a caller can convert the result before commit.
    /// A failed conversion must drop this projection. Serialize preparation and
    /// commit on the same owner; no other projection may commit between them.
    pub(crate) fn prepare(
        &self,
        table_max: u16,
        rows: &[LeaderboardScoreInput],
    ) -> Result<LeaderboardScoreProjection, LeaderboardScoreError> {
        if table_max == 0 {
            return Err(ScoreError::ZeroTableMax.into());
        }
        if rows.len() > MAX_ROWS {
            return Err(LeaderboardScoreError::TooManyRows);
        }
        for row in rows {
            if !row.fractional_mass.is_finite() || !(0. ..=1.).contains(&row.fractional_mass) {
                return Err(ScoreError::InvalidFractionalMass.into());
            }
        }
        let mut scores = reserve_scores(rows.len())?;
        let replacement = if self.tables.as_ref().map(ScoreTables::table_max) == Some(table_max) {
            None
        } else {
            Some(ScoreTables::new(table_max)?)
        };
        let tables = replacement.as_ref().or(self.tables.as_ref()).unwrap();
        for row in rows {
            scores.push(
                match tables.score(usize::from(row.count), row.fractional_mass) {
                    Ok(value) => LeaderboardRowScore::Value(value),
                    Err(ScoreError::IndexOutOfRange) => LeaderboardRowScore::OutOfTable,
                    Err(error) => return Err(error.into()),
                },
            );
        }
        Ok(LeaderboardScoreProjection {
            scores,
            replacement,
        })
    }

    /// Consume a successfully converted stage; this step allocates nothing.
    pub(crate) fn commit(
        &mut self,
        projection: LeaderboardScoreProjection,
    ) -> Vec<LeaderboardRowScore> {
        if let Some(tables) = projection.replacement {
            self.tables = Some(tables);
        }
        projection.scores
    }
}

fn reserve_scores(len: usize) -> Result<Vec<LeaderboardRowScore>, LeaderboardScoreError> {
    let mut scores = Vec::new();
    scores
        .try_reserve_exact(len)
        .map_err(|_| LeaderboardScoreError::AllocationFailed)?;
    Ok(scores)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepared_replacement_is_disposable_and_equal_parameter_borrows_cache() {
        let mut projector = LeaderboardScoreProjector::new();
        assert!(projector.tables.is_none());
        let first = projector.prepare(1, &[]).unwrap();
        assert!(first.replacement.is_some());
        assert!(projector.tables.is_none());
        projector.commit(first);
        let unsupported = projector
            .prepare(
                1,
                &[LeaderboardScoreInput {
                    count: 2050,
                    fractional_mass: 1.,
                }],
            )
            .unwrap();
        assert_eq!(unsupported.scores(), [LeaderboardRowScore::OutOfTable]);
        assert_eq!(
            projector.commit(unsupported),
            [LeaderboardRowScore::OutOfTable]
        );
        let same = projector.prepare(1, &[]).unwrap();
        assert!(same.replacement.is_none());
        assert!(same.scores().is_empty());
        projector.commit(same);
        let changed = projector.prepare(2, &[]).unwrap();
        assert_eq!(changed.replacement.as_ref().unwrap().table_max(), 2);
        assert_eq!(projector.tables.as_ref().unwrap().table_max(), 1);
        // Dropping models a failed result conversion before the cache commit.
        drop(changed);
        assert_eq!(projector.tables.as_ref().unwrap().table_max(), 1);
        let changed = projector.prepare(2, &[]).unwrap();
        projector.commit(changed);
        assert_eq!(projector.tables.as_ref().unwrap().table_max(), 2);
    }

    #[test]
    fn invalid_whole_batch_preserves_absent_and_existing_cache() {
        let mut projector = LeaderboardScoreProjector::new();
        let rows = [
            LeaderboardScoreInput {
                count: 1,
                fractional_mass: 0.,
            },
            LeaderboardScoreInput {
                count: u16::MAX,
                fractional_mass: f64::NAN,
            },
        ];
        assert!(projector.prepare(2, &rows).is_err());
        assert!(projector.tables.is_none());
        projector.project(1, &[]).unwrap();
        assert!(projector.prepare(2, &rows).is_err());
        assert_eq!(projector.tables.as_ref().unwrap().table_max(), 1);
        assert!(projector.prepare(1, &[]).unwrap().replacement.is_none());
    }

    #[test]
    fn capacity_overflow_maps_to_recoverable_reservation_error() {
        // Exercises the real fallible reservation helper, not allocator OOM.
        assert_eq!(
            reserve_scores(usize::MAX),
            Err(LeaderboardScoreError::AllocationFailed)
        );
    }
}
