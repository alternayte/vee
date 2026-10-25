// SPDX-License-Identifier: AGPL-3.0-or-later
// Client schema (SQLite through PowerSync). Rules from the SDD: id is a UUIDv7
// made on the device; every synced table has user_id, created_at, updated_at
// and deleted_at; column types are text, integer and real only; JSON goes in
// text columns; no foreign-key or unique constraints.
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const common = {
  id: text("id").primaryKey(),
  user_id: text("user_id"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  deleted_at: text("deleted_at"),
};

/** JSON, validated with Zod on read and on upload. */
const json = (name: string) => text(name);

export const profiles = sqliteTable("profiles", {
  ...common,
  height_cm: integer("height_cm"),
  birth_year: integer("birth_year"),
  sex: text("sex"),
  units: text("units"),
  locale: text("locale"),
  timezone: text("timezone"),
  goal_template: text("goal_template"),
  minutes_per_session: integer("minutes_per_session"),
  sessions_per_week: integer("sessions_per_week"),
  time_of_day: text("time_of_day"),
  quiet_hours: json("quiet_hours"),
});

export const kit_items = sqliteTable("kit_items", {
  ...common,
  kind: text("kind").notNull(),
  params: json("params"),
  count: integer("count"),
});

export const flags = sqliteTable("flags", {
  ...common,
  joint: text("joint").notNull(),
  severity: text("severity").notNull(),
  active_from: text("active_from").notNull(),
  active_to: text("active_to"),
});

export const programmes = sqliteTable("programmes", {
  ...common,
  goal_template: text("goal_template").notNull(),
  engine_version: text("engine_version").notNull(),
  rotation: json("rotation"),
  block_start: text("block_start").notNull(),
  block_week: integer("block_week"),
  early_deload_from: text("early_deload_from"),
  active: integer("active"),
});

export const session_templates = sqliteTable("session_templates", {
  ...common,
  programme_id: text("programme_id").notNull(),
  day_type: text("day_type").notNull(),
  name: text("name"),
  order: integer("order"),
  estimated_minutes: integer("estimated_minutes"),
  reasons: json("reasons"),
});

export const template_items = sqliteTable("template_items", {
  ...common,
  template_id: text("template_id").notNull(),
  family: text("family").notNull(),
  exercise_id: text("exercise_id").notNull(),
  role: text("role"),
  order: integer("order"),
  pair_group: integer("pair_group"),
  sets: integer("sets"),
  unit: text("unit"),
  rep_low: integer("rep_low"),
  rep_high: integer("rep_high"),
  load_kg: real("load_kg"),
  reasons: json("reasons"),
});

export const progress_state = sqliteTable("progress_state", {
  ...common,
  family: text("family").notNull(),
  exercise_id: text("exercise_id"),
  rung: integer("rung"),
  load_kg: real("load_kg"),
  band: json("band"),
  hold_s: integer("hold_s"),
  tempo_stage: integer("tempo_stage"),
  rep_override: json("rep_override"),
  best: real("best"),
  seen: integer("seen"),
  streaks: json("streaks"),
});

export const sessions = sqliteTable("sessions", {
  ...common,
  template_id: text("template_id"),
  kind: text("kind").notNull(),
  day_type: text("day_type"),
  status: text("status").notNull(),
  date: text("date").notNull(),
  started_at: text("started_at"),
  ended_at: text("ended_at"),
  readiness_mode: text("readiness_mode"),
  deload: integer("deload"),
});

/** One row per prescribed item, frozen at session start (I3). */
export const prescriptions = sqliteTable("prescriptions", {
  ...common,
  session_id: text("session_id").notNull(),
  section: text("section").notNull(),
  item_order: integer("item_order"),
  family: text("family"),
  exercise_id: text("exercise_id").notNull(),
  role: text("role"),
  sets: integer("sets"),
  target: json("target"),
  load_kg: real("load_kg"),
  band: json("band"),
  tempo: text("tempo"),
  rest_s: integer("rest_s"),
  pair_group: integer("pair_group"),
  reasons: json("reasons"),
  engine_version: text("engine_version").notNull(),
});

/** Append-only: an edit is a soft delete plus a new row. */
export const sets = sqliteTable("sets", {
  ...common,
  session_id: text("session_id").notNull(),
  exercise_id: text("exercise_id").notNull(),
  side: text("side"),
  reps: integer("reps"),
  seconds: integer("seconds"),
  load_kg: real("load_kg"),
  band: json("band"),
  effort: text("effort").notNull(),
  logged_at: text("logged_at").notNull(),
});

export const checkins = sqliteTable("checkins", {
  ...common,
  session_id: text("session_id"),
  date: text("date").notNull(),
  energy: integer("energy"),
  soreness: integer("soreness"),
  sleep: text("sleep"),
  hc_sleep_min: integer("hc_sleep_min"),
});

export const tests = sqliteTable("tests", {
  ...common,
  month: text("month").notNull(),
  date: text("date").notNull(),
});

export const test_results = sqliteTable("test_results", {
  ...common,
  test_id: text("test_id").notNull(),
  item: text("item").notNull(),
  value: real("value"),
  load_kg: real("load_kg"),
});

export const destinations = sqliteTable("destinations", {
  ...common,
  name: text("name").notNull(),
  criteria: json("criteria"),
});

export const body_metrics = sqliteTable("body_metrics", {
  ...common,
  kind: text("kind").notNull(),
  value: real("value"),
  source: text("source"),
  measured_at: text("measured_at").notNull(),
});

export const photos = sqliteTable("photos", {
  ...common,
  pose: text("pose").notNull(),
  taken_at: text("taken_at").notNull(),
  object_key: text("object_key"),
  sync_enabled: integer("sync_enabled"),
});

export const food_targets = sqliteTable("food_targets", {
  ...common,
  per_moment: json("per_moment"),
  adjusted_at: text("adjusted_at"),
  reason: json("reason"),
});

export const food_logs = sqliteTable("food_logs", {
  ...common,
  date: text("date").notNull(),
  moment: text("moment").notNull(),
  palm: real("palm"),
  fist: real("fist"),
  cupped: real("cupped"),
  thumb: real("thumb"),
  saved_meal_id: text("saved_meal_id"),
});

export const saved_meals = sqliteTable("saved_meals", {
  ...common,
  name: text("name").notNull(),
  moment: text("moment"),
  portions: json("portions"),
});

export const meals = sqliteTable("meals", {
  ...common,
  name: text("name").notNull(),
  steps: json("steps"),
  minutes: integer("minutes"),
  servings: integer("servings"),
  origin: text("origin"),
  rating: integer("rating"),
  lactose_ok: integer("lactose_ok"),
  no_cook: integer("no_cook"),
});

export const meal_ingredients = sqliteTable("meal_ingredients", {
  ...common,
  meal_id: text("meal_id").notNull(),
  ingredient_id: text("ingredient_id").notNull(),
  qty: real("qty"),
  unit: text("unit"),
  role: text("role"),
});

/** Seed rows ship with the app; user rows sync. */
export const ingredients = sqliteTable("ingredients", {
  ...common,
  name: text("name").notNull(),
  shop_section: text("shop_section"),
  lactose_class: text("lactose_class"),
  tags: json("tags"),
});

export const exclusions = sqliteTable("exclusions", {
  ...common,
  member_id: text("member_id"),
  ingredient_id: text("ingredient_id"),
  tag: text("tag"),
  kind: text("kind").notNull(),
});

export const household_members = sqliteTable("household_members", {
  ...common,
  name: text("name").notNull(),
  is_self: integer("is_self"),
});

export const meal_plans = sqliteTable("meal_plans", {
  ...common,
  week: text("week").notNull(),
  meal_ids: json("meal_ids"),
});

export const shopping_items = sqliteTable("shopping_items", {
  ...common,
  week: text("week").notNull(),
  ingredient_id: text("ingredient_id").notNull(),
  qty: real("qty"),
  unit: text("unit"),
  checked: integer("checked"),
  staple: integer("staple"),
});

export const shops = sqliteTable("shops", {
  ...common,
  name: text("name").notNull(),
  lat: real("lat"),
  lon: real("lon"),
  opening_hours: text("opening_hours"),
});

export const reviews = sqliteTable("reviews", {
  ...common,
  week: text("week").notNull(),
  numbers: json("numbers"),
  words: text("words"),
  model: text("model"),
});

export const ai_proposals = sqliteTable("ai_proposals", {
  ...common,
  source: text("source").notNull(),
  change: json("change"),
  validation: json("validation"),
  status: text("status").notNull(),
});

export const coach_links = sqliteTable("coach_links", {
  ...common,
  coach_id: text("coach_id").notNull(),
  client_id: text("client_id").notNull(),
  scopes: json("scopes"),
  status: text("status").notNull(),
});

export const comments = sqliteTable("comments", {
  ...common,
  target_type: text("target_type").notNull(),
  target_id: text("target_id").notNull(),
  author_id: text("author_id").notNull(),
  body: text("body"),
});

export const messages = sqliteTable("messages", {
  ...common,
  coach_link_id: text("coach_link_id").notNull(),
  author_id: text("author_id").notNull(),
  body: text("body"),
});

/** Server writes it; the client reads it through sync. */
export const entitlements = sqliteTable("entitlements", {
  ...common,
  tier: text("tier").notNull(),
  source: text("source"),
  until: text("until"),
});

/** Same shape as a catalogue exercise, as JSON. */
export const custom_exercises = sqliteTable("custom_exercises", {
  ...common,
  exercise: json("exercise").notNull(),
});

/** Local only: crash-safe session runner state. */
export const runner_state = sqliteTable("runner_state", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  cursor: json("cursor"),
  rest_ends_at: text("rest_ends_at"),
  json: json("json"),
  updated_at: text("updated_at").notNull(),
});

/** Local only: theme, last tab. */
export const ui_prefs = sqliteTable("ui_prefs", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value"),
});

/** Local only: operations the server refused (I5). The local row stays; Settings → Sync lists these. */
export const sync_errors = sqliteTable("sync_errors", {
  id: text("id").primaryKey(),
  table_name: text("table_name").notNull(),
  row_id: text("row_id").notNull(),
  op: text("op").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  data: json("data"),
  created_at: text("created_at").notNull(),
});

export const syncedTables = {
  profiles,
  kit_items,
  flags,
  programmes,
  session_templates,
  template_items,
  progress_state,
  sessions,
  prescriptions,
  sets,
  checkins,
  tests,
  test_results,
  destinations,
  body_metrics,
  photos,
  food_targets,
  food_logs,
  saved_meals,
  meals,
  meal_ingredients,
  ingredients,
  exclusions,
  household_members,
  meal_plans,
  shopping_items,
  shops,
  reviews,
  ai_proposals,
  coach_links,
  comments,
  messages,
  entitlements,
  custom_exercises,
};

export const localTables = { runner_state, ui_prefs, sync_errors };

export const clientSchema = { ...syncedTables, ...localTables };
