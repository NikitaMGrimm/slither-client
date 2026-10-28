//! Copied-data conversion for presentation::HudHistory; no DOM or lifecycle policy.

use js_sys::{Array, Object, Reflect};
use wasm_bindgen::{JsCast, convert::TryFromJsValue, prelude::*};

use crate::presentation::{HudHistory, HudHistoryEvent, HudLifecycle, HudSample, SnakeObjectToken};

fn invalid() -> JsValue {
    js_sys::TypeError::new("Invalid HUD state change").into()
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

fn boolean(value: &JsValue, key: &str) -> Result<bool, JsValue> {
    data(value, key)?.as_bool().ok_or_else(invalid)
}

fn integer16(value: &JsValue, key: &str) -> Result<u16, JsValue> {
    let n = number(value, key)?;
    if !n.is_finite() || n.fract() != 0. || !(0. ..=65535.).contains(&n) {
        return Err(invalid());
    }
    Ok(n as u16)
}

fn token(value: JsValue) -> Result<SnakeObjectToken, JsValue> {
    SnakeObjectToken::new(u64::try_from_js_value(value).map_err(|_| invalid())?)
        .map_err(|_| invalid())
}

fn sample(value: &JsValue) -> Result<Option<HudSample>, JsValue> {
    if value.is_null() {
        return Ok(None);
    }
    if data(value, "status")?.as_string().as_deref() != Some("ready") {
        return Ok(None);
    }
    Ok(Some(HudSample {
        score: number(value, "score")?,
        token: token(data(&data(value, "own")?, "token")?)?,
    }))
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

fn token_value(value: Option<SnakeObjectToken>) -> JsValue {
    value.map_or(JsValue::NULL, |token| JsValue::from(token.serial()))
}

fn opacity(state: &HudHistory) -> Result<JsValue, JsValue> {
    let value = state.requested_opacity;
    record(&[
        ("readout", value.readout.into()),
        ("header", value.header.into()),
        ("rows", value.rows.into()),
        ("announcement", value.announcement.into()),
    ])
}

/// Immutable Rust-owned semantic history. JS holds only copied snapshots and guards.
#[wasm_bindgen(js_name = HudHistory)]
#[derive(Default)]
pub struct BrowserHudHistory {
    inner: HudHistory,
}

#[wasm_bindgen(js_class = HudHistory)]
impl BrowserHudHistory {
    /// Start one independent history.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Pure eligibility observation; never reads a scene.
    pub fn required(&self, playing: bool) -> bool {
        self.inner.readout_required(playing)
    }

    /// Convert already copied/closed JS input before constructing a candidate.
    pub fn reduce(&self, change: &JsValue) -> Result<Self, JsValue> {
        let kind = data(change, "kind")?.as_string().ok_or_else(invalid)?;
        let inner = match kind.as_str() {
            "world-reset" => self.inner.reset_world(),
            "draw" => {
                let view = data(change, "view")?;
                let sample = sample(&view)?;
                if !view.is_null() && sample.is_none() {
                    return Err(invalid());
                }
                self.inner
                    .draw(boolean(change, "playing")?, sample)
                    .map_err(|_| invalid())?
            }
            "step" => {
                let life = data(change, "lifecycle")?;
                self.inner
                    .step(
                        number(change, "delta")?,
                        HudLifecycle {
                            death_pending: boolean(&life, "deathPending")?,
                            return_active: boolean(&life, "returnActive")?,
                            return_completed: boolean(&life, "returnCompleted")?,
                            return_fraction: number(&life, "returnFraction")?,
                        },
                    )
                    .map_err(|_| invalid())?
            }
            "packet" => {
                let events = data(&data(change, "report")?, "events")?;
                if !Array::is_array(&events) {
                    return Err(invalid());
                }
                let length = number(&events, "length")?;
                if !(0. ..=8192.).contains(&length) {
                    return Err(invalid());
                }
                let mut copied = Vec::with_capacity(length as usize);
                for index in 0..length as usize {
                    let event = data(&events, &index.to_string())?;
                    let kind = data(&event, "kind")?.as_string().ok_or_else(invalid)?;
                    copied.push(match kind.as_str() {
                        "setup" => HudHistoryEvent::Setup,
                        "setup-draw" => HudHistoryEvent::SetupDraw(sample(&data(&event, "view")?)?),
                        "own-length-scheduled" => {
                            HudHistoryEvent::OwnLengthScheduled(token(data(&event, "token")?)?)
                        }
                        "leaderboard" => HudHistoryEvent::Leaderboard {
                            rank: integer16(&event, "rank")?,
                            population: integer16(&event, "population")?,
                            death_pending: boolean(&event, "deathPending")?,
                        },
                        "final-score" => HudHistoryEvent::FinalScore(
                            sample(&data(&event, "view")?)?.ok_or_else(invalid)?,
                        ),
                        _ => return Err(invalid()),
                    });
                }
                self.inner.packet(&copied).map_err(|_| invalid())?
            }
            _ => return Err(invalid()),
        };
        Ok(Self { inner })
    }

    /// Copy diagnostic history, retaining the established field names and Number values.
    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let state = &self.inner;
        let current = state.current.map_or(Ok(JsValue::NULL), |value| {
            record(&[
                ("score", value.sample.score.into()),
                ("rank", value.rank.into()),
                ("population", value.population.into()),
                ("ownToken", token_value(Some(value.sample.token))),
            ])
        })?;
        let final_value = state.final_capture.map_or(Ok(JsValue::NULL), |value| {
            record(&[
                ("score", value.sample.score.into()),
                ("exclamation", value.exclamation.into()),
                ("ownToken", token_value(Some(value.sample.token))),
            ])
        })?;
        record(&[
            ("ownToken", token_value(state.own_token)),
            ("rank", state.rank.into()),
            ("population", state.population.into()),
            ("bestRank", state.best_rank.into()),
            ("maxPopulation", state.max_population.into()),
            ("dirty", state.dirty.into()),
            ("fade", state.fade.into()),
            ("requestedOpacity", opacity(state)?),
            ("current", current),
            ("final", final_value),
        ])
    }

    /// Copy formatted semantic values. Binding identity/readiness stays in JS.
    pub fn values(&self, includes_final: bool) -> Result<JsValue, JsValue> {
        let current = self.inner.current.map_or(Ok(JsValue::NULL), |value| {
            let text = value.score_text().map_err(|_| invalid())?;
            record(&[
                ("score", value.sample.score.into()),
                ("scoreText", text.into()),
                ("rank", value.rank.into()),
                ("rankText", value.rank_text().into()),
                ("population", value.population.into()),
                ("populationText", value.population_text().into()),
                ("ownToken", token_value(Some(value.sample.token))),
            ])
        })?;
        let final_value = if includes_final {
            self.inner
                .final_capture
                .map_or(Ok(JsValue::NULL), |value| {
                    let text = value.score_text().map_err(|_| invalid())?;
                    record(&[
                        ("score", value.sample.score.into()),
                        ("scoreText", text.into()),
                        ("exclamation", value.exclamation.into()),
                        ("suffix", value.suffix().into()),
                        ("ownToken", token_value(Some(value.sample.token))),
                    ])
                })?
        } else {
            JsValue::NULL
        };
        record(&[("current", current), ("final", final_value)])
    }
}
