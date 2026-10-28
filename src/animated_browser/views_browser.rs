use super::*;

fn minimap_point(point: Point) -> Result<JsValue, JsValue> {
    record([("x", point.x.into()), ("y", point.y.into())])
}

fn minimap_rgb(rgb: [u8; 3]) -> JsValue {
    rgb.into_iter()
        .map(JsValue::from)
        .collect::<js_sys::Array>()
        .into()
}

pub(super) fn minimap_widget_record(widget: MinimapWidgetPlan<'_>) -> Result<JsValue, JsValue> {
    let background = widget.background;
    let quadrants = js_sys::Array::new();
    for angles in background.quadrant_angles {
        quadrants.push(
            &angles
                .into_iter()
                .map(JsValue::from)
                .collect::<js_sys::Array>(),
        );
    }
    let diameters = js_sys::Array::new();
    for endpoints in background.diameters {
        let points = js_sys::Array::new();
        for point in endpoints {
            points.push(&minimap_point(point)?);
        }
        diameters.push(&points);
    }
    let images = js_sys::Array::new();
    for image in widget.images {
        images.push(&record([
            ("dimension", image.dimension.into()),
            ("left", image.top_left.x.into()),
            ("top", image.top_left.y.into()),
            ("opacity", image.opacity.into()),
            ("zIndex", image.z_index.into()),
        ])?);
    }
    let marker = widget.marker;
    let label = widget.label;
    record([
        ("side", widget.side.into()),
        ("right", widget.right_bottom.x.into()),
        ("bottom", widget.right_bottom.y.into()),
        ("zIndex", widget.z_index.into()),
        ("opacity", widget.opacity.into()),
        (
            "background",
            record([
                ("center", minimap_point(background.center)?),
                ("radius", background.radius.into()),
                ("fill", minimap_rgb(background.fill)),
                ("quadrantFill", minimap_rgb(background.quadrant_fill)),
                ("quadrantAngles", quadrants.into()),
                ("diameters", diameters.into()),
                ("stroke", minimap_rgb(background.stroke)),
                ("strokeWidth", background.stroke_width.into()),
                ("shadowBlur", background.shadow_blur.into()),
                ("shadowOffset", minimap_point(background.shadow_offset)?),
                ("opacity", background.opacity.into()),
                ("zIndex", background.z_index.into()),
            ])?,
        ),
        ("images", images.into()),
        (
            "marker",
            record([
                ("left", marker.top_left.x.into()),
                ("top", marker.top_left.y.into()),
                ("side", marker.side.into()),
                ("center", minimap_point(marker.center)?),
                ("radius", marker.radius.into()),
                ("stroke", minimap_rgb(marker.stroke)),
                ("strokeWidth", marker.stroke_width.into()),
                ("fill", minimap_rgb(marker.fill)),
                ("opacity", marker.opacity.into()),
                ("zIndex", marker.z_index.into()),
            ])?,
        ),
        (
            "label",
            record([
                ("text", label.text.into()),
                ("left", label.top_left.x.into()),
                ("top", label.top_left.y.into()),
                ("width", label.size.x.into()),
                ("height", label.size.y.into()),
                ("fontSize", label.font_size.into()),
                ("fontFamily", label.font_family.into()),
                ("textAlign", label.text_align.into()),
                ("overflowHidden", label.overflow_hidden.into()),
                ("fill", minimap_rgb(label.fill)),
                ("opacity", label.opacity.into()),
                ("shadowOffset", minimap_point(label.shadow_offset)?),
                ("shadowBlur", label.shadow_blur.into()),
            ])?,
        ),
    ])
}

pub(super) fn control_view_record(view: ClientControlView) -> Result<JsValue, JsValue> {
    let point = |p: Point| record([("x", p.x.into()), ("y", p.y.into())]);
    let own = match view.own {
        None => JsValue::NULL,
        Some(own) => record([
            ("token", serial(own.token.serial())),
            ("id", own.id.into()),
            ("rawHead", point(own.raw_head)?),
            ("wantedHeading", own.wanted_heading.into()),
            ("gazeHeading", own.gaze_heading.into()),
            ("dead", own.dead.into()),
            ("turnRate", own.turn_rate.into()),
            ("sizeTurnFactor", own.size_turn_factor.into()),
            ("speedTurnFactor", own.speed_turn_factor.into()),
        ])?,
    };
    record([
        ("own", own),
        ("camera", point(view.camera)?),
        ("zoom", view.zoom.into()),
        ("follows", view.follows.into()),
        ("connected", view.connected.into()),
    ])
}

pub(super) fn score_view_record(view: ClientScoreView) -> Result<JsValue, JsValue> {
    let own = match view.own {
        None => JsValue::NULL,
        Some(own) => record([
            ("token", serial(own.token.serial())),
            ("id", own.id.into()),
            ("logicalSegments", (own.logical_segments as f64).into()),
            ("fractionalMass", own.fractional_mass.into()),
            ("scoreAdjustment", own.score_adjustment.into()),
            ("scoreIndex", (own.score_index as f64).into()),
        ])?,
    };
    let (status, score, reason) = match view.status {
        ScoreStatus::Disabled => ("disabled", JsValue::NULL, JsValue::NULL),
        ScoreStatus::NoTables => ("no-tables", JsValue::NULL, JsValue::NULL),
        ScoreStatus::NoOwn => ("no-own", JsValue::NULL, JsValue::NULL),
        ScoreStatus::Ready(value) => ("ready", value.into(), JsValue::NULL),
        ScoreStatus::Unsupported(reason) => (
            "unsupported",
            JsValue::NULL,
            match reason {
                ScoreError::ZeroTableMax => "zero-table-max",
                ScoreError::InvalidFractionalMass => "invalid-fractional-mass",
                ScoreError::IndexOutOfRange => "index-out-of-range",
            }
            .into(),
        ),
    };
    record([
        ("schema", 1.into()),
        ("enabled", view.enabled.into()),
        (
            "tableMax",
            view.table_max.map(JsValue::from).unwrap_or(JsValue::NULL),
        ),
        ("own", own),
        ("status", status.into()),
        ("score", score),
        ("error", reason),
    ])
}

// Both helpers catch every JavaScript reflection/copy/freeze failure at the
// borrowed Wasm boundary. The shared authored contract owns the closed grammar.
#[wasm_bindgen(module = "/web/stock-hud-contract.mjs")]
extern "C" {
    #[wasm_bindgen(catch, js_name = copyHudIngressPlan)]
    fn copy_hud_plan(value: &JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch, js_name = copyHudIngressReport)]
    fn copy_hud_report(value: &JsValue, command_count: usize) -> Result<JsValue, JsValue>;
}

pub(super) struct OwnedHudPlan {
    schema: u8,
    guards: Vec<HudCommandGuard>,
    captures: Vec<usize>,
}

impl OwnedHudPlan {
    pub(super) fn parse(value: &JsValue) -> Result<Self, JsValue> {
        let value = copy_hud_plan(value)?;
        let get = |value: &JsValue, key: &str| js_sys::Reflect::get(value, &key.into());
        let count = crate::body_browser::integer(get(&value, "commandCount")?, 1, 4096)?;
        let guards = get(&value, "guards")?;
        let captures = get(&value, "finalCaptureIndices")?;
        let capture_count = crate::body_browser::integer(get(&captures, "length")?, 0, count)?;
        let mut result = Self {
            schema: crate::body_browser::integer(get(&value, "schema")?, 1, 2)? as u8,
            guards: Vec::new(),
            captures: Vec::new(),
        };
        result
            .guards
            .try_reserve(count)
            .map_err(|_| error("HUD plan allocation failed"))?;
        result
            .captures
            .try_reserve(capture_count)
            .map_err(|_| error("HUD plan allocation failed"))?;
        for index in 0..count {
            let guard = get(&guards, &index.to_string())?;
            result.guards.push(HudCommandGuard {
                playing: crate::body_browser::flag(get(&guard, "playing")?)?,
                close_requested: crate::body_browser::flag(get(&guard, "closeRequested")?)?,
                death_pending: crate::body_browser::flag(get(&guard, "deathPending")?)?,
            });
        }
        for index in 0..capture_count {
            result.captures.push(crate::body_browser::integer(
                get(&captures, &index.to_string())?,
                0,
                count - 1,
            )?);
        }
        Ok(result)
    }

    pub(super) fn borrowed(&self) -> HudIngressPlan<'_> {
        HudIngressPlan {
            schema: self.schema,
            command_count: self.guards.len(),
            guards: &self.guards,
            final_capture_indices: &self.captures,
        }
    }
}

fn hud_leaderboard_rows_record(report: &HudIngressReport) -> Result<JsValue, JsValue> {
    let boards = js_sys::Array::new();
    for (board_index, board) in report.leaderboard_rows().iter().enumerate() {
        let rows = js_sys::Array::new();
        for (row_index, row) in board.rows().iter().enumerate() {
            let name = js_sys::Array::new();
            for (index, byte) in row.name().iter().enumerate() {
                if !js_sys::Reflect::set(&name, &(index as u32).into(), &(*byte).into())? {
                    return Err(error("could not construct HUD row name"));
                }
            }
            let value = record([
                ("ordinal", row.ordinal().into()),
                ("count", row.count().into()),
                ("fractionalMass", row.fractional_mass().into()),
                ("rawColor", row.raw_color().into()),
                ("paletteIndex", row.palette_index().into()),
                ("name", name.into()),
            ])?;
            if !js_sys::Reflect::set(&rows, &(row_index as u32).into(), &value)? {
                return Err(error("could not construct HUD rows"));
            }
        }
        let value = record([
            ("commandIndex", (board.command_index() as f64).into()),
            ("rows", rows.into()),
        ])?;
        if !js_sys::Reflect::set(&boards, &(board_index as u32).into(), &value)? {
            return Err(error("could not construct HUD leaderboard boards"));
        }
    }
    Ok(boards.into())
}

fn preflight_hud_leaderboard_rows(report: &HudIngressReport) -> Result<(), JsValue> {
    if report.schema() != 2 {
        return Ok(());
    }
    let resource = || error("HUD leaderboard rows resource limit");
    if report.leaderboard_rows().len() > report.command_count() {
        return Err(resource());
    }
    let mut row_count = 0_usize;
    let mut wire_bytes = 0_usize;
    for board in report.leaderboard_rows() {
        row_count = row_count
            .checked_add(board.rows().len())
            .ok_or_else(resource)?;
        if row_count > (MAX_FRAME_BYTES - 6) / 7 {
            return Err(resource());
        }
        wire_bytes = wire_bytes.checked_add(6).ok_or_else(resource)?;
        for row in board.rows() {
            if row.name().len() > usize::from(u8::MAX) {
                return Err(resource());
            }
            wire_bytes = wire_bytes
                .checked_add(7 + row.name().len())
                .ok_or_else(resource)?;
            if wire_bytes > MAX_FRAME_BYTES {
                return Err(resource());
            }
        }
        if wire_bytes > MAX_FRAME_BYTES {
            return Err(resource());
        }
    }
    Ok(())
}

pub(super) fn hud_report_record(report: &HudIngressReport) -> Result<JsValue, JsValue> {
    // Bound aggregate row output before allocating either output journal.
    preflight_hud_leaderboard_rows(report)?;
    let events = js_sys::Array::new();
    for (index, event) in report.events().iter().enumerate() {
        let command = ("commandIndex", JsValue::from(event.command_index as f64));
        let value = match event.kind {
            HudIngressEventKind::Setup { table_max } => record([
                command,
                ("kind", "setup".into()),
                ("tableMax", table_max.into()),
            ])?,
            HudIngressEventKind::SetupDraw { view } => record([
                command,
                ("kind", "setup-draw".into()),
                ("view", score_view_record(view)?),
            ])?,
            HudIngressEventKind::OwnLengthScheduled { token } => record([
                command,
                ("kind", "own-length-scheduled".into()),
                ("token", serial(token.serial())),
            ])?,
            HudIngressEventKind::Leaderboard {
                local_row,
                rank,
                population,
                death_pending,
            } => record([
                command,
                ("kind", "leaderboard".into()),
                ("localRow", local_row.into()),
                ("rank", rank.into()),
                ("population", population.into()),
                ("deathPending", death_pending.into()),
            ])?,
            HudIngressEventKind::FinalScore { view } => record([
                command,
                ("kind", "final-score".into()),
                ("view", score_view_record(view)?),
            ])?,
        };
        if !js_sys::Reflect::set(&events, &(index as u32).into(), &value)? {
            return Err(error("could not construct HUD events"));
        }
    }
    let value = record([
        ("schema", report.schema().into()),
        ("commandCount", (report.command_count() as f64).into()),
        ("setupDraws", (report.setup_draws() as f64).into()),
        ("events", events.into()),
    ])?;
    if report.schema() == 2
        && !js_sys::Reflect::set(
            &value,
            &"leaderboardRows".into(),
            &hud_leaderboard_rows_record(report)?,
        )?
    {
        return Err(error("could not construct HUD leaderboard rows"));
    }
    copy_hud_report(&value, report.command_count())
}
