//! Copied-data conversion and output caching for the browser-free leaderboard owner.

use js_sys::{Array, BigInt, Object, Reflect};
use wasm_bindgen::{JsCast, prelude::*};

use crate::presentation::{
    LeaderboardEvent, LeaderboardEventKind, LeaderboardHistory, LeaderboardPlan, LeaderboardRawRow,
    LeaderboardRow,
};

fn invalid() -> JsValue {
    js_sys::TypeError::new("Invalid leaderboard state change").into()
}

fn data(value: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    if !value.is_object() || value.is_null() {
        return Err(invalid());
    }
    let descriptor =
        Reflect::get_own_property_descriptor(value.unchecked_ref::<Object>(), &key.into())?;
    if descriptor.is_undefined()
        || !Object::has_own(descriptor.unchecked_ref::<Object>(), &"value".into())
    {
        return Err(invalid());
    }
    Reflect::get(&descriptor, &"value".into())
}

fn number(value: &JsValue, key: &str) -> Result<f64, JsValue> {
    data(value, key)?.as_f64().ok_or_else(invalid)
}

fn integer(value: &JsValue, key: &str, maximum: usize) -> Result<usize, JsValue> {
    let n = number(value, key)?;
    if !n.is_finite() || n.fract() != 0. || !(0. ..=maximum as f64).contains(&n) {
        return Err(invalid());
    }
    Ok(n as usize)
}

fn length(value: &JsValue, maximum: usize) -> Result<usize, JsValue> {
    if !Array::is_array(value) {
        return Err(invalid());
    }
    integer(value, "length", maximum)
}

fn record(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let result = Object::new();
    for (key, value) in fields {
        if !Reflect::set(&result, &(*key).into(), value)? {
            return Err(invalid());
        }
    }
    Ok(Object::freeze(&result).into())
}

fn array(values: impl IntoIterator<Item = JsValue>) -> JsValue {
    let array = Array::new();
    for value in values {
        array.push(&value);
    }
    Object::freeze(&array).into()
}

fn rows(values: &[LeaderboardRow]) -> Result<JsValue, JsValue> {
    let mut copied = Vec::with_capacity(values.len());
    for row in values {
        copied.push(record(&[
            ("ordinal", (row.ordinal as f64).into()),
            ("numberText", row.number_text.as_str().into()),
            ("score", row.score.into()),
            ("scoreText", row.score_text.as_str().into()),
            ("nameText", row.name_text.as_str().into()),
            ("cssColor", row.css_color.into()),
            ("own", row.own.into()),
            ("opacityRequest", row.opacity_request.into()),
        ])?);
    }
    Ok(array(copied))
}

fn events(report: &JsValue) -> Result<Vec<LeaderboardEvent>, JsValue> {
    if number(report, "schema")? != 2. {
        return Err(invalid());
    }
    let events = data(report, "events")?;
    let size = length(&events, 8192)?;
    let boards = data(report, "leaderboardRows")?;
    let board_count = length(&boards, 4096)?;
    let mut board_index = 0;
    let mut row_total = 0;
    let mut byte_total = 0;
    let mut result = Vec::new();
    for index in 0..size {
        let event = data(&events, &index.to_string())?;
        let kind = data(&event, "kind")?.as_string().ok_or_else(invalid)?;
        let semantic = match kind.as_str() {
            "setup" => LeaderboardEventKind::Setup(integer(&event, "tableMax", 65535)? as u16),
            "leaderboard" => {
                if board_index >= board_count {
                    return Err(invalid());
                }
                let board = data(&boards, &board_index.to_string())?;
                board_index += 1;
                if number(&board, "commandIndex")? != number(&event, "commandIndex")? {
                    return Err(invalid());
                }
                let raw_rows = data(&board, "rows")?;
                let row_count = length(&raw_rows, 149795 - row_total)?;
                row_total += row_count;
                byte_total += 6 + 7 * row_count;
                if byte_total > crate::protocol::MAX_FRAME_BYTES {
                    return Err(invalid());
                }
                let mut rows = Vec::with_capacity(row_count);
                for ordinal in 0..row_count {
                    let row = data(&raw_rows, &ordinal.to_string())?;
                    let raw_name = data(&row, "name")?;
                    let name_count = length(&raw_name, 255)?;
                    byte_total += name_count;
                    if byte_total > crate::protocol::MAX_FRAME_BYTES {
                        return Err(invalid());
                    }
                    let mut name = Vec::with_capacity(name_count);
                    for index in 0..name_count {
                        name.push(integer(&raw_name, &index.to_string(), 255)? as u8);
                    }
                    rows.push(LeaderboardRawRow {
                        count: integer(&row, "count", 65535)? as u16,
                        fractional_mass: number(&row, "fractionalMass")?,
                        raw_color: integer(&row, "rawColor", 255)? as u8,
                        name,
                    });
                }
                LeaderboardEventKind::Board {
                    local_row: integer(&event, "localRow", 255)? as u8,
                    rows,
                }
            }
            "setup-draw" | "own-length-scheduled" | "final-score" => continue,
            _ => return Err(invalid()),
        };
        result.push(LeaderboardEvent {
            command_index: integer(&event, "commandIndex", 4095)?,
            kind: semantic,
        });
    }
    if board_index != board_count {
        return Err(invalid());
    }
    Ok(result)
}

/// Opaque one-use raw companion. JS holds only its issued identity and copied requests.
#[wasm_bindgen(js_name = LeaderboardPlan)]
pub struct BrowserLeaderboardPlan {
    inner: Option<LeaderboardPlan>,
}

/// Immutable native board history with copied-output identity caching at this boundary.
#[wasm_bindgen(js_name = LeaderboardHistory)]
#[derive(Default)]
pub struct BrowserLeaderboardHistory {
    inner: LeaderboardHistory,
    board_snapshot: Option<JsValue>,
}

impl BrowserLeaderboardHistory {
    fn candidate(&self, inner: LeaderboardHistory) -> Self {
        let board_snapshot = if self.inner.shares_board(&inner) {
            self.board_snapshot.clone()
        } else {
            None
        };
        Self {
            inner,
            board_snapshot,
        }
    }

    fn revision(&self) -> Result<JsValue, JsValue> {
        Ok(BigInt::new(&self.inner.revision().decimal().into())?.into())
    }

    fn matching(&self, plan: &BrowserLeaderboardPlan) -> Result<(), JsValue> {
        if !self.inner.is_open()
            || !plan
                .inner
                .as_ref()
                .is_some_and(|plan| plan.belongs_to(&self.inner))
        {
            return Err(invalid());
        }
        Ok(())
    }
}

#[wasm_bindgen(js_class = LeaderboardHistory)]
impl BrowserLeaderboardHistory {
    /// Start with no Setup and no board.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Check transition freshness while retaining readable historical snapshots.
    pub fn is_open(&self) -> bool {
        self.inner.is_open()
    }

    /// Stage a fully copied admitted report without changing history.
    pub fn prepare(&self, report: &JsValue) -> Result<BrowserLeaderboardPlan, JsValue> {
        Ok(BrowserLeaderboardPlan {
            inner: Some(
                self.inner
                    .prepare(&events(report)?)
                    .map_err(|_| invalid())?,
            ),
        })
    }

    /// Copy command-time numeric requests; raw companions remain in Rust.
    pub fn requests(&self, plan: &BrowserLeaderboardPlan) -> Result<JsValue, JsValue> {
        self.matching(plan)?;
        let mut requests = Vec::new();
        for request in plan.inner.as_ref().unwrap().requests() {
            requests.push(record(&[
                ("commandIndex", (request.command_index as f64).into()),
                ("tableMax", request.table_max.into()),
                (
                    "counts",
                    array(request.counts.iter().map(|n| JsValue::from(*n))),
                ),
                (
                    "fractionalMasses",
                    array(request.fractional_masses.iter().map(|n| JsValue::from(*n))),
                ),
            ])?);
        }
        Ok(array(requests))
    }

    /// Consume plan admission before caller-controlled nickname/result conversion.
    pub fn begin_plan(&self, plan: &mut BrowserLeaderboardPlan) -> Result<(), JsValue> {
        self.matching(plan)?;
        plan.inner.as_mut().unwrap().begin().map_err(|_| invalid())
    }

    /// Admit the primitive nickname before any score-array reflection.
    pub fn admit_name(&self, value: &JsValue) -> Result<(), JsValue> {
        let value = value.as_string().ok_or_else(invalid)?;
        crate::presentation::validate_leaderboard_nickname(&value).map_err(|_| invalid())
    }

    /// Preserve per-element semantic admission before reflecting through later results.
    pub fn admit_score(
        &self,
        plan: &BrowserLeaderboardPlan,
        board: usize,
        row: usize,
        value: &JsValue,
    ) -> Result<(), JsValue> {
        self.matching(plan)?;
        let request = plan
            .inner
            .as_ref()
            .unwrap()
            .requests()
            .get(board)
            .ok_or_else(invalid)?;
        let count = *request.counts.get(row).ok_or_else(invalid)?;
        crate::presentation::validate_leaderboard_score(
            request.table_max,
            count,
            value.as_f64().ok_or_else(invalid)?,
        )
        .map_err(|_| invalid())
    }

    /// Convert copied numeric results and stage every semantic output before commit.
    pub fn complete(
        &self,
        plan: &mut BrowserLeaderboardPlan,
        scores: &JsValue,
        nickname: &JsValue,
    ) -> Result<Self, JsValue> {
        self.matching(plan)?;
        // Consume before any fallible JS result conversion, including descriptor traps.
        let mut native = plan.inner.take().ok_or_else(invalid)?;
        let name = nickname.as_string().ok_or_else(invalid)?;
        let size = length(scores, native.requests().len())?;
        if size != native.requests().len() {
            return Err(invalid());
        }
        let mut copied = Vec::with_capacity(size);
        for (index, request) in native.requests().iter().enumerate() {
            let values = data(scores, &index.to_string())?;
            let size = length(&values, request.counts.len())?;
            if size != request.counts.len() {
                return Err(invalid());
            }
            let mut numbers = Vec::with_capacity(size);
            for index in 0..size {
                numbers.push(number(&values, &index.to_string())?);
            }
            copied.push(numbers);
        }
        let inner = self
            .inner
            .stage_complete(&mut native, &copied, &name)
            .map_err(|_| invalid())?;
        Ok(self.candidate(inner))
    }

    /// Destroy a consumed or failed operation's raw companion.
    pub fn discard_plan(&self, _plan: BrowserLeaderboardPlan) {}

    /// Stage reset while retaining the exact displayed board and Setup/table history.
    pub fn reset(&self) -> Result<Self, JsValue> {
        Ok(self.candidate(self.inner.stage_reset().map_err(|_| invalid())?))
    }

    /// Publish after copied-output conversion and JS capability/reentry checks succeed.
    pub fn commit(&self) -> Result<(), JsValue> {
        self.inner.commit().map_err(|_| invalid())
    }

    /// Copy the established diagnostic state. Unchanged board output keeps its identity.
    pub fn snapshot(&mut self) -> Result<JsValue, JsValue> {
        let board = if let Some(value) = &self.board_snapshot {
            value.clone()
        } else if let Some(board) = self.inner.board() {
            let copied = record(&[("rows", rows(board)?)])?;
            self.board_snapshot = Some(copied.clone());
            copied
        } else {
            JsValue::NULL
        };
        record(&[
            (
                "tableMax",
                self.inner.table_max().map_or(JsValue::NULL, JsValue::from),
            ),
            ("setupSeen", self.inner.setup_seen().into()),
            ("revision", self.revision()?),
            ("board", board),
        ])
    }

    /// Copy Rust-selected visible rows, borrowing the already-owned HUD opacity requests.
    pub fn projection(&self, heading_opacity: f64, row_opacity: f64) -> Result<JsValue, JsValue> {
        let view = self.inner.view(heading_opacity, row_opacity);
        record(&[
            ("revision", self.revision()?),
            ("setupSeen", self.inner.setup_seen().into()),
            ("boardPresent", view.board_present.into()),
            ("readiness", view.readiness.into()),
            ("reason", view.reason.map_or(JsValue::NULL, JsValue::from)),
            (
                "requestedOpacity",
                record(&[
                    ("heading", view.heading_opacity.into()),
                    ("rows", view.row_opacity.into()),
                ])?,
            ),
            ("rows", rows(view.rows)?),
        ])
    }
}
