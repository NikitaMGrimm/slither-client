//! Browser conversion only; policy lives in presentation::announcement.

use wasm_bindgen::{JsCast, JsValue};

use crate::presentation::{AnnouncementLifecycle, AnnouncementView};

fn invalid() -> JsValue {
    js_sys::TypeError::new("invalid announcement lifecycle").into()
}

pub(crate) fn lifecycle(value: &JsValue) -> Result<AnnouncementLifecycle, JsValue> {
    let names = [
        "schema",
        "deathPending",
        "returnActive",
        "returnCompleted",
        "returnFraction",
    ];
    if !value.is_object() || value.is_null() {
        return Err(invalid());
    }
    let prototype = js_sys::Reflect::get_prototype_of(value)?;
    if !prototype.is_null()
        && !js_sys::Object::is(
            &prototype,
            &js_sys::Object::get_prototype_of(&js_sys::Object::new()),
        )
    {
        return Err(invalid());
    }
    let keys = js_sys::Reflect::own_keys(value)?;
    if keys.length() != names.len() as u32 {
        return Err(invalid());
    }
    let mut fields = std::array::from_fn::<_, 5, _>(|_| JsValue::UNDEFINED);
    for key in keys {
        let name = key.as_string().ok_or_else(invalid)?;
        let index = names
            .iter()
            .position(|&candidate| candidate == name)
            .ok_or_else(invalid)?;
        let descriptor = js_sys::Reflect::get_own_property_descriptor(
            value.unchecked_ref::<js_sys::Object>(),
            &key,
        )?;
        if descriptor.is_undefined()
            || !js_sys::Object::has_own(
                descriptor.unchecked_ref::<js_sys::Object>(),
                &"value".into(),
            )
        {
            return Err(invalid());
        }
        fields[index] = js_sys::Reflect::get(&descriptor, &"value".into())?;
    }
    if fields[0].as_f64() != Some(1.) {
        return Err(invalid());
    }
    Ok(AnnouncementLifecycle {
        death_pending: fields[1].as_bool().ok_or_else(invalid)?,
        return_active: fields[2].as_bool().ok_or_else(invalid)?,
        return_completed: fields[3].as_bool().ok_or_else(invalid)?,
        return_fraction: fields[4].as_f64().ok_or_else(invalid)?,
    })
}

fn record(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let record = js_sys::Object::new();
    for (key, value) in fields {
        if !js_sys::Reflect::set(&record, &(*key).into(), value)? {
            return Err(invalid());
        }
    }
    Ok(js_sys::Object::freeze(&record).into())
}

pub(crate) fn view(view: AnnouncementView) -> Result<JsValue, JsValue> {
    let lines = js_sys::Array::new();
    for line in view.lines {
        lines.push(&record(&[
            ("text", line.text.into()),
            ("fontSize", line.font_size.into()),
            ("bold", line.bold.into()),
            ("italic", line.italic.into()),
            ("spaceAfter", line.space_after.into()),
        ])?);
    }
    js_sys::Object::freeze(&lines);
    record(&[
        ("schema", 1.into()),
        ("present", view.present.into()),
        ("opacity", view.opacity.into()),
        ("left", view.left.into()),
        ("top", view.top.into()),
        ("width", view.width.into()),
        ("height", view.height.into()),
        ("lines", lines.into()),
    ])
}
