//! Isolated menu submission through the existing borrowed-source/body/face renderer.

use js_sys::{Function, Object, Reflect, Uint8Array};
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

use crate::{
    animated_browser::{PreviewFaceLayout, submit_preview_antenna, submit_preview_face},
    appearance_preview::{
        AppearancePreview as Preview, MAX_PREVIEW_SAMPLES, PREVIEW_HEAD, PREVIEW_HEIGHT,
        PREVIEW_WIDTH, PreviewAvailability, PreviewFace,
    },
    body_browser::{BorrowedSources, field},
    presentation::{
        BodyPaintInput, BodyPaintQuality, FacePresentation, plan_standard_body,
        plan_standard_body_with_antenna,
    },
};

fn error(message: &str) -> JsValue {
    JsValue::from_str(message)
}

fn set(object: &Object, key: &str, value: JsValue) -> Result<(), JsValue> {
    if Reflect::set(object, &key.into(), &value)? {
        Ok(())
    } else {
        Err(error("Cannot copy preview projection"))
    }
}

fn view(
    revision: u64,
    availability: PreviewAvailability,
    changed: bool,
) -> Result<JsValue, JsValue> {
    let result = Object::new();
    for (key, value) in [
        ("schema", 1.into()),
        ("revision", revision.into()),
        ("changed", changed.into()),
        ("width", PREVIEW_WIDTH.into()),
        ("height", PREVIEW_HEIGHT.into()),
        (
            "visible",
            (availability == PreviewAvailability::Ready).into(),
        ),
        ("statusText", availability.message().into()),
    ] {
        set(&result, key, value)?;
    }
    Ok(Object::freeze(&result).into())
}

/// Only selection/revision state is retained. Sources, frames and plans are per call.
#[wasm_bindgen]
pub struct AppearancePreview {
    inner: Preview,
}

#[wasm_bindgen]
impl AppearancePreview {
    /// Create a static preview in the chooser's existing local or stock route.
    #[wasm_bindgen(constructor)]
    pub fn new(local: bool) -> Self {
        Self {
            inner: Preview::new(local),
        }
    }

    /// Copy selection under the menu guard; this observes no sources or Canvas.
    pub fn select(&mut self, skin: f64, custom: &[u8]) -> Result<u64, JsValue> {
        if !skin.is_finite() || skin.fract() != 0. || !(0. ..=255.).contains(&skin) {
            return Err(error("Invalid preview skin"));
        }
        self.inner.select(skin as u8, custom).map_err(error)
    }

    /// Native ticket used to reject queued jobs after another menu selection.
    pub fn revision(&self) -> u64 {
        self.inner.revision()
    }

    /// Check a queued ticket before opening any borrowed-source operation.
    pub fn needs_draw(&self, revision: u64) -> bool {
        self.inner.needs_draw(revision)
    }

    /// Resolve one existing provider recipe and submit to a distinct owned target.
    /// `prepare` is a captured native frame capability, invoked only after planning.
    pub fn render(
        &mut self,
        revision: u64,
        target: &HtmlCanvasElement,
        world_target: &HtmlCanvasElement,
        resolve_recipe: &Function,
        prepare: &Function,
    ) -> Result<JsValue, JsValue> {
        if revision == 0 || revision != self.inner.revision() {
            return Err(error("Stale preview selection"));
        }
        if target == world_target {
            return Err(error("Preview target must be isolated"));
        }
        if !self.inner.needs_draw(revision) {
            return view(revision, PreviewAvailability::Ready, false);
        }
        let descriptor = self.inner.descriptor(false).map_err(error)?;
        let request = Object::new();
        for (key, value) in [
            ("skin", self.inner.skin().into()),
            ("customBytes", Uint8Array::from(self.inner.custom()).into()),
            ("own", false.into()),
            ("cosmetic", 0.into()),
            ("x", PREVIEW_HEAD.x.into()),
            ("y", PREVIEW_HEAD.y.into()),
        ] {
            set(&request, key, value)?;
        }
        let request = Object::freeze(&request);
        // Exactly one caller provider invocation. Parsing the returned snapshot
        // below uses a private synchronous closure and does not reacquire sources.
        let response = resolve_recipe.call1(&JsValue::UNDEFINED, &request)?;
        let availability = match field(&response, "status")?.as_string().as_deref() {
            Some("pending") => Some(PreviewAvailability::Pending),
            Some("unsupported") => Some(PreviewAvailability::Unsupported),
            Some("ready") => None,
            _ => return Err(error("Existing preview recipe status required")),
        };
        if let Some(availability) = availability {
            return view(revision, availability, true);
        }
        let cached = Closure::<dyn FnMut(JsValue) -> JsValue>::new(move |_| response.clone());
        let mut sources = BorrowedSources::default();
        let recipe = sources.resolve_with_face(
            cached.as_ref().unchecked_ref(),
            &request,
            target,
            &FacePresentation {
                face: descriptor.face,
                antenna: descriptor.antenna.map(|antenna| antenna.geometry),
            },
        )?;
        // The gameplay target is forbidden even if a provider placed it in a
        // nominally ready catalog. No pixels are read from either target.
        sources.validate(world_target)?;
        let plan = self
            .inner
            .plan(!recipe.style.rotate_segments)
            .map_err(error)?;
        let palettes = recipe.palettes();
        let input = BodyPaintInput {
            geometry: plan.geometry.as_paint_geometry(),
            recipe: recipe.borrowed(&palettes),
            assets: &recipe.assets,
            view: plan.view,
            quality: BodyPaintQuality {
                high_quality: true,
                blend: 1.,
            },
            visual: plan.visual,
            entry_alpha: 1.,
            command_limit: 8 * MAX_PREVIEW_SAMPLES + 16,
        };
        let body = if let Some(antenna) = &plan.antenna {
            plan_standard_body_with_antenna(input, antenna.barrier_effect)
        } else {
            plan_standard_body(input)
        }
        .map_err(|_| error("Invalid preview body plan"))?;
        let face = match plan.face {
            PreviewFace::Paired { eyes, decoration } => PreviewFaceLayout::Paired {
                eyes: Some(eyes),
                decoration,
            },
            PreviewFace::SingleImage(layout) => PreviewFaceLayout::SingleImage(layout),
            PreviewFace::Mouth(layout) => PreviewFaceLayout::Mouth(layout),
        };
        sources.validate(target)?;
        sources.validate(world_target)?;
        let frame = prepare.call3(
            &JsValue::UNDEFINED,
            target,
            &PREVIEW_WIDTH.into(),
            &PREVIEW_HEIGHT.into(),
        )?;
        let finish = field(&frame, "finish")?
            .dyn_into::<Function>()
            .map_err(|_| error("Captured preview frame cleanup required"))?;
        let result = (|| {
            let context = field(&frame, "context")?
                .dyn_into::<CanvasRenderingContext2d>()
                .map_err(|_| error("Captured preview context required"))?;
            context.set_transform(1., 0., 0., 1., 0., 0.)?;
            context.set_global_alpha(1.);
            context.set_global_composite_operation("source-over")?;
            for command in &body.commands[..body.antenna_barrier] {
                sources.submit(&context, command)?;
            }
            if let Some(antenna) = &plan.antenna {
                submit_preview_antenna(&sources, &context, recipe.antenna.as_ref(), antenna)?;
            }
            for command in &body.commands[body.antenna_barrier..] {
                sources.submit(&context, command)?;
            }
            submit_preview_face(&sources, &context, recipe.face.as_ref(), face, false, None)?;
            sources.validate(target)?;
            sources.validate(world_target)?;
            Ok::<_, JsValue>(())
        })();
        let cleanup = finish.call0(&JsValue::UNDEFINED);
        result?; // Includes an exact caller-thrown undefined, before cleanup errors.
        cleanup?;
        let output = view(revision, PreviewAvailability::Ready, true)?;
        self.inner.mark_drawn(revision).map_err(error)?;
        Ok(output)
    }
}
