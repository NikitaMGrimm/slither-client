use super::*;

#[wasm_bindgen]
impl AnimatedScene {
    /// Copied pre-motion original-own and displayed-camera data. Tokens are BigInt
    /// serials scoped to this scene instance, never reused by world reset.
    pub fn control_view(&self) -> Result<JsValue, JsValue> {
        control_view_record(self.client.control_view())
    }

    /// Copy retained original-own score inputs and status without advancing time.
    /// The scene-scoped token is a BigInt; no table storage or mutable alias escapes.
    pub fn score_view(&self) -> Result<JsValue, JsValue> {
        score_view_record(self.client.score_view())
    }

    /// Copy the current Rust text/layout/opacity projection without an update.
    pub fn announcement_view(&self) -> Result<JsValue, JsValue> {
        crate::announcement_browser::view(self.client.announcement_view())
    }

    /// Copy native widget data and, only when its revision differs, both RGBA
    /// images. Omitting known_image_revision requests a complete pixel copy.
    /// Output contains no Wasm-memory aliases, clocks or browser source objects.
    pub fn minimap_view(
        &self,
        right_ui_inset: f64,
        bottom_ui_offset: f64,
        known_image_revision: Option<u64>,
    ) -> Result<JsValue, JsValue> {
        let view = self.client.minimap_view();
        let plan = self
            .client
            .minimap_render_plan(MinimapLayout {
                right_ui_inset,
                bottom_ui_offset,
            })
            .map_err(error)?;
        let copy_pixels = known_image_revision != Some(view.image_revision);
        let widget = match plan.widget {
            Some(widget) => minimap_widget_record(widget)?,
            None => JsValue::NULL,
        };
        record([
            ("schema", 1.into()),
            ("enabled", self.client.minimap_tracking_enabled().into()),
            ("imageRevision", serial(view.image_revision)),
            (
                "dimension",
                view.dimension.map(JsValue::from).unwrap_or(JsValue::NULL),
            ),
            (
                "baseRgba",
                if copy_pixels {
                    js_sys::Uint8Array::from(view.base_rgba).into()
                } else {
                    JsValue::NULL
                },
            ),
            (
                "alternateRgba",
                if copy_pixels {
                    js_sys::Uint8Array::from(view.alternate_rgba).into()
                } else {
                    JsValue::NULL
                },
            ),
            ("widget", widget),
        ])
    }

    /// Copied family and shared gaze state for every retained appearance.
    /// Native Number fields preserve signed zeros; observation advances no clock.
    pub fn face_state(&self) -> Result<JsValue, JsValue> {
        let snakes = js_sys::Array::new();
        for (token, own, drawn, snake) in self.client.snake_objects() {
            let face = match snake.active_face_geometry() {
                FaceGeometry::Paired(_) => {
                    record([("kind", "paired".into()), ("geometry", JsValue::NULL)])?
                }
                FaceGeometry::SingleImage(geometry) => record([
                    ("kind", "single-image".into()),
                    (
                        "geometry",
                        record([
                            ("baseSize", geometry.base_size.into()),
                            ("pupilSize", geometry.pupil_size.into()),
                            ("pupilTravel", geometry.pupil_travel.into()),
                        ])?,
                    ),
                ])?,
                FaceGeometry::Mouth(geometry) => record([
                    ("kind", "mouth-face".into()),
                    (
                        "geometry",
                        record([("pupilTravel", geometry.pupil_travel.into())])?,
                    ),
                ])?,
            };
            let eyes = snake.eyes();
            snakes.push(&record([
                ("token", serial(token.serial())),
                ("id", snake.metrics().id.into()),
                ("own", own.into()),
                ("drawn", drawn.into()),
                ("face", face),
                ("heading", eyes.heading().into()),
                ("targetHeading", eyes.target_heading().into()),
                ("pupilX", eyes.pupil().x.into()),
                ("pupilY", eyes.pupil().y.into()),
            ])?);
        }
        record([
            ("enabled", self.client.face_presentation_enabled().into()),
            ("snakes", snakes.into()),
        ])
    }

    /// Fresh copies of retained appearance chains; observation advances no clock.
    pub fn antenna_state(&self) -> Result<JsValue, JsValue> {
        let bounds = self
            .client
            .antenna_bounds()
            .map(|bounds| {
                record([
                    ("minX", bounds.min_x.into()),
                    ("maxX", bounds.max_x.into()),
                    ("minY", bounds.min_y.into()),
                    ("maxY", bounds.max_y.into()),
                ])
            })
            .transpose()?
            .unwrap_or(JsValue::NULL);
        let snakes = js_sys::Array::new();
        for (token, own, drawn, snake) in self.client.snake_objects() {
            let antenna = if let Some(snapshot) = self.client.antenna_snapshot(token) {
                record([
                    ("geometry", antenna_geometry_snapshot(snapshot.geometry)?),
                    (
                        "x",
                        js_sys::Float32Array::from(snapshot.x.as_slice()).into(),
                    ),
                    (
                        "y",
                        js_sys::Float32Array::from(snapshot.y.as_slice()).into(),
                    ),
                    (
                        "velocityX",
                        js_sys::Float32Array::from(snapshot.velocity_x.as_slice()).into(),
                    ),
                    (
                        "velocityY",
                        js_sys::Float32Array::from(snapshot.velocity_y.as_slice()).into(),
                    ),
                    (
                        "accelerationX",
                        js_sys::Float32Array::from(snapshot.acceleration_x.as_slice()).into(),
                    ),
                    (
                        "accelerationY",
                        js_sys::Float32Array::from(snapshot.acceleration_y.as_slice()).into(),
                    ),
                    ("shown", snapshot.shown.into()),
                    ("bulbRotation", snapshot.bulb_rotation.into()),
                ])?
            } else {
                JsValue::NULL
            };
            snakes.push(&record([
                ("token", serial(token.serial())),
                ("id", snake.metrics().id.into()),
                ("own", own.into()),
                ("drawn", drawn.into()),
                ("antenna", antenna),
            ])?);
        }
        record([
            ("appearanceEnabled", self.client.appearance_enabled().into()),
            ("drawSerial", serial(self.client.draw_serial())),
            ("bounds", bounds),
            ("snakes", snakes.into()),
        ])
    }

    /// Numeric diagnostics. Input-facing ownHead/camera x/y are centered;
    /// nested own geometry and camera absoluteX/absoluteY retain absolute units.
    /// Radius is the received target; boundary reports the retained display and gate.
    pub fn snapshot(&self) -> String {
        let received = self.client.received();
        let center = received.setup.as_ref().map_or(0., |s| s.grid_center);
        let camera = self.client.camera();
        let position = camera.position();
        let offset = camera.corrections().offset();
        let own = self.client.own_snake();
        let input_head = self.client.active_own_snake();
        let own_head = input_head.map_or_else(
            || "null".into(),
            |snake| {
                let m = snake.metrics();
                object! {"x": m.corrected_head.x - center, "y": m.corrected_head.y - center, "skin": m.skin}
            },
        );
        object! {
            "frames": received.frames_applied, "commands": received.commands_applied,
            "ignored": received.ignored_commands, "snakes": received.snakes.len(),
            "foods": received.foods.len(), "gridCenter": center,
            "protocol": received.setup.as_ref().map_or_else(|| "null".into(), |s| s.protocol.to_string()),
            "radius": received.setup.as_ref().map_or(0., |s| s.radius),
            "boundary": self.client.boundary().map_or_else(|| "null".into(), |boundary| object! {
                "displayed": boundary.displayed(), "target": boundary.target(),
                "index": boundary.index(), "pending": boundary.pending(),
                "connected": self.client.connected()
            }),
            "ownId": received.own_snake_id.map_or_else(|| "null".into(), |id| id.to_string()),
            "ownHead": own_head,
            "retainedSnakes": self.client.retained_count(),
            "drawnSnakes": self.client.drawn_snakes().count(),
            "retainedBodyPoints": self.client.retained_body_points(),
            "camera": object! {
                "x": position.x - center, "y": position.y - center,
                "absoluteX": position.x, "absoluteY": position.y,
                "zoom": camera.zoom(), "follows": camera.follows(),
                "offsetX": offset.x, "offsetY": offset.y,
                "index": camera.corrections().index(), "pending": camera.corrections().pending()
            },
            "own": own.map_or_else(|| "null".into(), snake_snapshot)
        }
    }

    /// Copied center, camera angle and distance, preserving signed zeros.
    pub fn arena_edge_view(&self) -> Vec<f64> {
        let view = self.client.arena_edge_view();
        vec![view.center(), view.angle(), view.distance()]
    }

    /// Copied retained-food diagnostics with lossless BigInt identities and native
    /// Number cells, preserving signed zeros. This is separate from the received
    /// map count in `snapshot`; returned objects cannot mutate the model.
    pub fn food_state(&self) -> Result<JsValue, JsValue> {
        let rows = js_sys::Array::new();
        for food in self.client.foods().foods() {
            let f = food.snapshot();
            let sources = js_sys::Array::new();
            for source in [
                f.sources.body,
                f.sources.outline,
                f.sources.inner,
                f.sources.outer,
            ] {
                sources.push(&food_source_snapshot(source)?);
            }
            let indices = js_sys::Array::new();
            for index in f.sources.indices {
                indices.push(&JsValue::from_f64(index as f64));
            }
            rows.push(&record([
                ("instance", serial(f.instance.serial())),
                ("key", f.key.into()),
                ("sectorX", f.sector.0.into()),
                ("sectorY", f.sector.1.into()),
                ("x", f.position.x.into()),
                ("y", f.position.y.into()),
                ("rawColor", f.raw_color.into()),
                ("palette", f.effective_palette.into()),
                ("size", f.base_size.into()),
                ("spawnSpeed", f.spawn_speed.into()),
                ("renderX", f.render_position.x.into()),
                ("renderY", f.render_position.y.into()),
                ("fade", f.fade.into()),
                ("scale", f.scale.into()),
                ("uneatenScale", f.uneaten_scale.into()),
                ("phase", f.animation_phase.into()),
                ("rate", f.animation_rate.into()),
                ("wobbleRate", f.wobble_rate.into()),
                ("eaten", f.eaten.into()),
                ("progress", f.consumption_progress.into()),
                (
                    "eater",
                    f.eater.map_or(JsValue::NULL, |t| serial(t.serial())),
                ),
                ("creationZoom", f.creation_zoom.into()),
                ("indices", indices.into()),
                ("sources", sources.into()),
            ])?);
        }
        let bounds = self.client.food_bounds().map_or(JsValue::NULL, |bounds| {
            bounds
                .limits()
                .into_iter()
                .map(JsValue::from_f64)
                .collect::<js_sys::Array>()
                .into()
        });
        record([
            ("enabled", self.client.food_enabled().into()),
            (
                "receivedCount",
                (self.client.received().foods.len() as f64).into(),
            ),
            (
                "ownToken",
                self.client
                    .own_token()
                    .map_or(JsValue::NULL, |t| serial(t.serial())),
            ),
            ("sourceCount", (self.food_sources.len() as f64).into()),
            ("bounds", bounds),
            ("foods", rows.into()),
        ])
    }

    /// Copy prey scalars, retained identities and both Float32 correction rings.
    /// Diagnostics borrow no source objects and advance no update or draw state.
    pub fn prey_state(&self) -> Result<JsValue, JsValue> {
        let rows = js_sys::Array::new();
        for p in self.client.preys().snapshots() {
            let sources = js_sys::Array::new();
            sources.push(&food_source_snapshot(p.sources.body)?);
            sources.push(&food_source_snapshot(p.sources.glow)?);
            let indices = p
                .sources
                .indices
                .into_iter()
                .map(|v| JsValue::from_f64(v as f64))
                .collect::<js_sys::Array>();
            let counts = p
                .sources
                .family_counts
                .into_iter()
                .map(|v| JsValue::from_f64(v as f64))
                .collect::<js_sys::Array>();
            let samples = js_sys::Array::new();
            for channel in p.corrections.samples() {
                samples.push(&js_sys::Float32Array::from(channel.as_slice()));
            }
            let [offset_x, offset_y] = p.corrections.offset();
            let direction = match p.direction {
                crate::state::Direction::None => 0_u8,
                crate::state::Direction::Decreasing => 1,
                crate::state::Direction::Increasing => 2,
            };
            rows.push(&record([
                ("instance", serial(p.instance.serial())),
                ("id", p.id.into()),
                ("x", p.position.x.into()),
                ("y", p.position.y.into()),
                ("sizeByte", p.size_byte.into()),
                ("size", p.base_size.into()),
                ("rawColor", p.raw_color.into()),
                ("palette", p.palette.into()),
                ("direction", direction.into()),
                ("heading", p.heading.into()),
                ("wantedHeading", p.wanted_heading.into()),
                ("speedPer32ms", p.speed_per_32ms.into()),
                ("scale", p.scale.into()),
                ("fade", p.fade.into()),
                ("glowPhase", p.glow_phase.into()),
                ("glowRate", p.glow_rate.into()),
                ("randomPhaseUnit", p.random_phase_unit.into()),
                ("randomRateUnit", p.random_rate_unit.into()),
                ("creationZoom", p.creation_zoom.into()),
                ("eaten", p.eaten.into()),
                ("progress", p.consumption_progress.into()),
                (
                    "eater",
                    p.eater.map_or(JsValue::NULL, |t| serial(t.serial())),
                ),
                ("indices", indices.into()),
                ("familyCounts", counts.into()),
                ("sources", sources.into()),
                ("offsetX", offset_x.into()),
                ("offsetY", offset_y.into()),
                ("index", (p.corrections.index() as f64).into()),
                ("pending", p.corrections.pending().into()),
                ("samples", samples.into()),
                (
                    "weights",
                    js_sys::Float32Array::from(p.corrections.weights().as_slice()).into(),
                ),
            ])?);
        }
        record([
            ("enabled", self.client.prey_enabled().into()),
            ("sourceCount", (self.prey_sources.len() as f64).into()),
            ("preys", rows.into()),
        ])
    }

    /// Copied absolute-radius ring, retained across resets; draws never consume it.
    pub fn boundary_samples(&self) -> Vec<f64> {
        self.client
            .boundary()
            .map_or_else(Vec::new, |boundary| boundary.samples().to_vec())
    }

    /// Copied numeric snapshots in draw order, including culled entries. The own
    /// flag identifies the original object independently of a reused wire ID.
    pub fn drawn_snakes(&self) -> String {
        let own = self.client.own_snake();
        let rows = self
            .client
            .drawn_snakes()
            .enumerate()
            .map(|(ordinal, snake)| {
                object! {
                    "drawOrdinal": ordinal,
                    "own": own.is_some_and(|own| std::ptr::eq(own, snake)),
                    "snake": snake_snapshot(snake)
                }
            })
            .collect::<Vec<_>>();
        format!("[{}]", rows.join(","))
    }

    /// Read-only paired-eye layouts for currently visible drawn snakes. Rows:
    /// ordinal, ID, own, eye1 x/y, pupil1 x/y, eye2 x/y, pupil2 x/y,
    /// eye radius, pupil radius, outline width, eye alpha, pupil alpha (stride 16).
    /// This observes current state; it does not prepare or commit another draw.
    pub fn drawn_eyes(&self, width: f64, height: f64) -> Result<Vec<f64>, JsValue> {
        let viewport_half = Point {
            x: f64::from(dimensions(width)?) / 2.,
            y: f64::from(dimensions(height)?) / 2.,
        };
        let camera = self.client.camera();
        let own = self.client.own_snake();
        let mut rows = Vec::new();
        for (ordinal, snake) in self.client.drawn_snakes().enumerate() {
            let m = snake.metrics();
            if !m.visible || m.expired {
                continue;
            }
            let layout = snake
                .eye_geometry()
                .ok_or_else(|| error("drawn_eyes requires paired faces"))?
                .layout(
                    snake.eyes().heading(),
                    snake.eyes().pupil(),
                    EyeLayoutInput {
                        corrected_head: m.corrected_head,
                        camera: camera.position(),
                        viewport_half,
                        scale: m.scale,
                        zoom: camera.zoom(),
                        death_progress: m.death_progress,
                    },
                )
                .map_err(error)?;
            let [first, second] = layout.pairs;
            rows.extend([
                ordinal as f64,
                f64::from(m.id),
                f64::from(u8::from(own.is_some_and(|own| std::ptr::eq(own, snake)))),
                first.eye.x,
                first.eye.y,
                first.pupil.x,
                first.pupil.y,
                second.eye.x,
                second.eye.y,
                second.pupil.x,
                second.pupil.y,
                layout.eye_radius,
                layout.pupil_radius,
                layout.outline_width,
                layout.eye_alpha,
                layout.pupil_alpha,
            ]);
        }
        Ok(rows)
    }

    /// Copied own body rows: x/y, previous dx/dy, edge, spacing, fade, dying,
    /// x/y/edge/spacing offsets, correction index, pending count (stride 14).
    pub fn own_body(&self) -> Vec<f64> {
        self.client.own_snake().map_or_else(Vec::new, |snake| {
            snake
                .body()
                .points()
                .iter()
                .flat_map(|point| {
                    let p = point.position();
                    let d = point.previous_delta();
                    let o = point.offset();
                    [
                        p.x,
                        p.y,
                        d.x,
                        d.y,
                        point.edge_length(),
                        point.spacing_multiplier(),
                        point.tail_fade(),
                        f64::from(u8::from(point.dying())),
                        o[0],
                        o[1],
                        o[2],
                        o[3],
                        point.index() as f64,
                        f64::from(point.pending()),
                    ]
                })
                .collect()
        })
    }

    /// Copied own body samples: point, channel (x/y/edge/spacing), then 53 slots.
    pub fn own_body_samples(&self) -> Vec<f32> {
        self.client.own_snake().map_or_else(Vec::new, |snake| {
            snake
                .body()
                .points()
                .iter()
                .flat_map(|p| p.samples().iter().flatten().copied())
                .collect()
        })
    }

    /// Copied own head channels, in x/y/fraction order.
    pub fn head_samples(&self) -> Vec<f32> {
        self.client.own_snake().map_or_else(Vec::new, |s| {
            s.head_corrections()
                .samples()
                .iter()
                .flatten()
                .copied()
                .collect()
        })
    }

    /// Copied own heading correction samples.
    pub fn angle_samples(&self) -> Vec<f32> {
        self.client
            .own_snake()
            .map_or_else(Vec::new, |s| s.angle_corrections().samples().to_vec())
    }

    /// Copied own displayed-length correction samples.
    pub fn length_samples(&self) -> Vec<f32> {
        self.client
            .own_snake()
            .map_or_else(Vec::new, |s| s.length().samples().to_vec())
    }

    /// Copied double-precision camera channels, x followed by y.
    pub fn camera_samples(&self) -> Vec<f64> {
        self.client
            .camera()
            .corrections()
            .samples()
            .iter()
            .flatten()
            .copied()
            .collect()
    }

    /// Sample the prepared visible own geometry without advancing any draw clock.
    /// Flat output is x/y/tailward-angle in Float32 storage order.
    pub fn own_curve(&self, quality_scale: f64, detailed_style: bool) -> Result<Vec<f32>, JsValue> {
        quality(quality_scale)?;
        let Some(snake) = self.client.drawn_own_snake().filter(|s| has_curve(s)) else {
            return Ok(Vec::new());
        };
        Ok(curve(snake, quality_scale, detailed_style)?
            .samples
            .into_iter()
            .flat_map(|p| [p.x, p.y, p.angle])
            .collect())
    }

    /// Copied pre/post-redistribution diagnostics for a prepared visible own curve.
    /// Rows are sampled x/y, final f64 x/y, distance-present, distance (stride 6).
    pub fn own_curve_vertices(
        &self,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<Vec<f64>, JsValue> {
        quality(quality_scale)?;
        let Some(snake) = self.client.drawn_own_snake().filter(|s| has_curve(s)) else {
            return Ok(Vec::new());
        };
        Ok(curve(snake, quality_scale, detailed_style)?
            .vertices()
            .iter()
            .flat_map(|v| {
                [
                    v.sampled.x,
                    v.sampled.y,
                    v.position.x,
                    v.position.y,
                    f64::from(u8::from(v.distance_from_previous.is_some())),
                    v.distance_from_previous.unwrap_or(0.),
                ]
            })
            .collect())
    }

    /// Active sample count, prepared spacing, eye target and redistribution count.
    pub fn own_curve_info(
        &self,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<Vec<f64>, JsValue> {
        quality(quality_scale)?;
        let Some(snake) = self.client.drawn_own_snake().filter(|s| has_curve(s)) else {
            return Ok(Vec::new());
        };
        let output = curve(snake, quality_scale, detailed_style)?;
        Ok(vec![
            output.samples.len() as f64,
            output.point_spacing,
            output.target_eye_heading,
            output.redistribution_count() as f64,
        ])
    }
}
