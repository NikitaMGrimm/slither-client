use super::*;

/// Independently owned raw-row numeric cache; no scene, source or clock access.
#[wasm_bindgen]
pub struct LeaderboardScoreProjector {
    projector: NativeLeaderboardScoreProjector,
    brand: js_sys::Function,
    length: js_sys::Function,
    constructor: js_sys::Function,
    construct: js_sys::Function,
}

#[wasm_bindgen]
impl LeaderboardScoreProjector {
    /// Capture typed-array operations and start with no score-table cache.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<LeaderboardScoreProjector, JsValue> {
        let [brand, length] = ANTENNA_RANDOM_ACCESSORS.with(Clone::clone)?;
        let prototype = js_sys::Object::get_prototype_of(&js_sys::Float64Array::new_with_length(0));
        let constructor = js_sys::Reflect::get(&prototype, &"constructor".into())?
            .dyn_into::<js_sys::Function>()
            .map_err(|_| error("Float64Array constructor unavailable"))?;
        let reflect = js_sys::Reflect::get(&js_sys::global(), &"Reflect".into())?;
        let construct = js_sys::Reflect::get(&reflect, &"construct".into())?
            .dyn_into::<js_sys::Function>()
            .map_err(|_| error("typed-array construction unavailable"))?;
        Ok(Self {
            projector: NativeLeaderboardScoreProjector::new(),
            brand,
            length,
            constructor,
            construct,
        })
    }

    /// Return copied f64 scores, with NaN only for a raw count beyond the table.
    /// Cache commit follows all fallible input and JavaScript output work.
    pub fn project(
        &mut self,
        table_max: JsValue,
        counts: JsValue,
        fractional_masses: JsValue,
    ) -> Result<js_sys::Float64Array, JsValue> {
        let table_max = crate::body_browser::integer(table_max, 1, 65535)? as u16;
        let size = |value: &JsValue| -> Result<usize, JsValue> {
            if !js_sys::ArrayBuffer::is_view(value)
                || self.brand.call0(value)?.as_string().as_deref() != Some("Float64Array")
            {
                return Err(error("leaderboard inputs must be Float64Array"));
            }
            crate::body_browser::integer(self.length.call0(value)?, 0, 149_795)
        };
        let count = size(&counts)?;
        if size(&fractional_masses)? != count {
            return Err(error("leaderboard input lengths differ"));
        }
        let counts: js_sys::Float64Array = counts.unchecked_into();
        let masses: js_sys::Float64Array = fractional_masses.unchecked_into();
        let mut rows = Vec::new();
        rows.try_reserve_exact(count)
            .map_err(|_| error("leaderboard input allocation failed"))?;
        for index in 0..count {
            let raw_count = counts.get_index(index as u32);
            let mass = masses.get_index(index as u32);
            if !raw_count.is_finite()
                || raw_count.fract() != 0.
                || !(0. ..=65535.).contains(&raw_count)
                || !mass.is_finite()
                || !(0. ..=1.).contains(&mass)
            {
                return Err(error("invalid leaderboard numeric input"));
            }
            rows.push(LeaderboardScoreInput {
                count: raw_count as u16,
                fractional_mass: mass,
            });
        }
        let prepared = self.projector.prepare(table_max, &rows).map_err(error)?;
        // Catch construction failures so the stage drops and the Wasm borrow
        // releases before another call or disposal can observe this owner.
        let arguments = js_sys::Array::new();
        arguments.push(&(count as u32).into());
        let value = self
            .construct
            .call2(&JsValue::UNDEFINED, &self.constructor, &arguments)?;
        if !js_sys::ArrayBuffer::is_view(&value)
            || self.brand.call0(&value)?.as_string().as_deref() != Some("Float64Array")
            || self.length.call0(&value)?.as_f64() != Some(count as f64)
        {
            return Err(error("leaderboard result construction failed"));
        }
        let result: js_sys::Float64Array = value.unchecked_into();
        for (index, score) in prepared.scores().iter().enumerate() {
            result.set_index(
                index as u32,
                match score {
                    LeaderboardRowScore::Value(value) => *value,
                    LeaderboardRowScore::OutOfTable => f64::NAN,
                },
            );
        }
        drop(self.projector.commit(prepared));
        Ok(result)
    }
}
