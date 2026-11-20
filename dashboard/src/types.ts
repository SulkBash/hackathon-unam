export interface OverviewSummary {
  total_games: number;
  total_plays: number;
  total_players: number;
  total_matchups: number;
  weeks: string;
  season: number;
  league_pressure_rate: number;
  league_sack_rate: number;
  clean_comp_rate: number;
  pressured_comp_rate: number;
  clean_avg_yds: number;
  pressured_avg_yds: number;
}

export interface PressureImpactRow {
  label: string;
  plays: number;
  comp_rate: number;
  sack_rate: number;
  int_rate: number;
  avg_yards: number;
}

export interface DtParadoxRow {
  label: string;
  double_teams: number;
  plays: number;
  free_rusher_rate: number;
  pressure_rate: number;
  sack_rate: number;
  comp_rate: number;
  avg_yards: number;
}

export interface GravityLiftRow {
  label: string;
  snaps: number;
  self_pressure_rate: number;
  teammate_pressure_rate: number;
  any_play_pressure_rate: number;
  free_rusher_rate: number;
}

export interface StuntImpactRow {
  group: string;
  rush_type: string;
  stunt: boolean;
  plays: number;
  pressure_rate: number;
  sack_rate: number;
  comp_rate: number;
  avg_yards: number;
}

export interface DropbackCounterRow {
  code: string;
  label: string;
  plays: number;
  pressure_rate: number;
  sack_rate: number;
  comp_rate: number;
  avg_yards: number;
}

export interface ProtectionTierRow {
  label: string;
  plays: number;
  pressure_rate: number;
  sack_rate: number;
  comp_rate: number;
  avg_yards: number;
}

export interface BlitzSituationRow {
  situation: string;
  strategy: string;
  label: string;
  plays: number;
  pressure_rate: number;
  sack_rate: number;
  comp_rate: number;
  avg_yards: number;
}

export interface BlockSchemeRow {
  code: string;
  label: string;
  snaps: number;
  pressure_allowed_rate: number;
  beaten_rate: number;
  sack_allowed_rate: number;
}

export interface OlLaneRow {
  lane: string;
  snaps: number;
  pressure_allowed_rate: number;
  beaten_rate: number;
  sack_allowed_rate: number;
}

export interface TeamMatrixRow {
  team: string;
  teamName: string;
  def_plays: number;
  blitz_rate: number;
  press_rate: number;
  press_rate_4man: number;
  stunt_rate: number;
  sack_rate: number;
  avg_yds_allowed: number;
  off_press_allowed_rate: number;
  off_avg_yds: number;
  plays_4man?: number;
  def_getoff_rel?: number;
  off_sack_rate?: number;
  off_late_share?: number;
  off_ttt_median?: number;
}

export interface OverviewData {
  summary: OverviewSummary;
  block_schemes?: BlockSchemeRow[];
  ol_lanes?: OlLaneRow[];
  team_matrix: TeamMatrixRow[];
  /** Split-half (weeks 1-4 vs 5-8) correlation of each team_matrix column. */
  team_matrix_stability?: Record<string, number>;
  /** Legacy v1 tables (removed by the audit). Never rendered. */
  pressure_impact?: PressureImpactRow[];
  dt_paradox?: DtParadoxRow[];
  gravity_lift?: GravityLiftRow[];
  stunt_impact?: StuntImpactRow[];
  dropback_counters?: DropbackCounterRow[];
  protection_tiers?: ProtectionTierRow[];
  blitz_situations?: BlitzSituationRow[];
}

export interface GravityDefender {
  nflId: number;
  displayName: string;
  position: string;
  linedUp: string;
  team: string;
  snaps_4man: number;
  total_snaps: number;
  dt_snaps: number;
  dt_rate: number;
  self_press_rate: number;
  press_vs_dt_rate: number;
  tm_press_when_dt: number;
  tm_lift: number;
  total_pressures: number;
  sacks: number;
  gravity_score: number;
  invisible_star: boolean;
}

export interface IronLineman {
  nflId: number;
  displayName: string;
  position: string;
  lane: string;
  team: string;
  snaps: number;
  pressures_allowed: number;
  sacks_allowed: number;
  clean_rate: number;
  beaten_rate: number;
  stunt_snaps: number;
  iron_score: number;
}

export interface QbPoiseRow {
  nflId: number;
  displayName: string;
  team: string;
  total_plays: number;
  clean_plays: number;
  press_plays: number;
  pressure_faced_rate: number;
  clean_yds: number;
  press_yds: number;
  yds_drop: number;
  clean_comp: number;
  press_comp: number;
  press_sack_rate: number;
  poise_score: number;
}

/** /api/players (PLAN 2.4): get-off leaderboard, always ranked WITHIN group (Edge = DE·OLB, Interior = DT·NT). */
export type RushGroup = 'Edge' | 'Interior';

export interface GetoffLeader {
  nflId?: number;
  name: string;
  team: string;
  position: string;
  group: RushGroup;
  snaps: number;
  getoff_avg: number;
  strain_avg: number;
  pressure_rate: number;
  sacks: number;
  getoff_score: number;
}

export interface PlayersData {
  getoff_leaders?: GetoffLeader[];
  linemen: IronLineman[];
  /** Legacy v1 fields (gravity / poise). Not rendered anymore. */
  defenders?: GravityDefender[];
  qbs?: unknown;
}

// ---------------------------------------------------------------------------
// /api/guerra (PLAN 2.2). Every number shown in "El Reloj" comes from here.
// ---------------------------------------------------------------------------
export interface GuerraHeadline {
  plays: number;
  games: number;
  rusher_snaps: number;
  clean_comp: number;
  pressured_comp: number;
  clean_success: number;
  pressured_success: number;
}

export interface CliffBucket {
  bucket: string;
  plays: number;
  pressure: number;
  sack: number;
  success: number;
  big: number;
}

export interface GetoffWithinRow {
  delta: number;
  label: string;
  snaps: number;
  pressure: number;
}

export interface GetoffSituationRow {
  situation: string;
  faster: number;
  slower: number;
}

export interface GuerraGetoff {
  within_player: GetoffWithinRow[];
  pp_per_tenth: number;
  base_rate: number;
  by_situation: GetoffSituationRow[];
  stability: number;
}

export interface GuerraPlayAction {
  pa_rate: number;
  getoff_no_pa: number;
  getoff_pa: number;
  getoff_delta_adj: number;
  ttt_no_pa: number;
  ttt_pa: number;
  success_pa: number;
  success_expected: number;
  big_pa: number;
  big_expected: number;
  pressure_pa: number;
  pressure_expected: number;
  sack_pa: number;
  sack_expected: number;
  rollout_sack: number;
  pocket_sack: number;
  rollout_pa_share: number;
  pa_rollout_sack: number;
  pa_rollout_n: number;
  pa_no_rollout_sack: number;
}

export interface BlitzOverallRow {
  label: string;
  plays: number;
  pressure: number;
  success: number;
}

export interface BlitzSituationAdj {
  situation: string;
  adj_delta: number;
  blitz_share?: number;
  metric?: string;
  plays?: number;
}

export interface ThirdLongPlan {
  plan: string;
  plays: number;
  adj_delta: number;
  sack?: number;
}

export interface GuerraBlitz {
  overall: BlitzOverallRow[];
  by_situation: BlitzSituationAdj[];
  third_long_sacks: { rush4: number; blitz: number };
  flip: { early: number; third_long: number; diff: number; z: number };
  third_long_plans: {
    base: { plan: string; plays: number; conversion: number; sack?: number };
    vs_base: ThirdLongPlan[];
  };
}

export interface RushPlanRow {
  plan: string;
  plays: number;
  pressure: number;
  sack: number;
  success: number;
  adj_delta: number;
  se?: number;
  z?: number;
}

export interface ProtectionRow {
  label: string;
  reps: number;
  lost: number;
}

export interface GuerraDangerZone {
  threshold?: number;
  sack_before?: number;
  sack_after?: number;
  success_before?: number;
  success_after?: number;
  late_share?: number;
  sack_multiplier_per_half_second?: number;
}

export interface GuerraData {
  headline: GuerraHeadline;
  cliff: CliffBucket[];
  danger_zone?: GuerraDangerZone;
  getoff: GuerraGetoff;
  play_action: GuerraPlayAction;
  blitz: GuerraBlitz;
  rush_plans: RushPlanRow[];
  protection: ProtectionRow[];
}

// ---------------------------------------------------------------------------
// /api/qb-clocks (PLAN 2.3). Ranked by late_share (stable trait), never by per-QB drop (noise).
// ---------------------------------------------------------------------------
export interface QbClockRow {
  nflId?: number;
  name: string;
  team: string;
  plays: number;
  ttt_median: number;
  late_share: number;
}

export interface QbClocksLeague {
  late_share: number;
  success_early: number;
  success_late: number;
  drop: number;
  ttt_median?: number;
}

export interface QbClocksData {
  league: QbClocksLeague;
  qbs: QbClockRow[];
  /** Optional split-half (weeks 1-4 vs 5-8) correlations, if the backend provides them. Never hard-code. */
  stability?: { late_share?: number; ttt_median?: number };
}

export interface PlaySummary {
  gameId: number;
  playId: number;
  week: number;
  matchup: string;
  offense: string;
  defense: string;
  quarter: number;
  gameClock: string;
  down: number;
  yardsToGo: number;
  passResult: string;
  playResult: number;
  qb: string;
  formation: string;
  dropBackType: string;
  coverage: string;
  n_rushers: number;
  n_blockers: number;
  n_dt_rushers?: number;
  n_free_rushers?: number;
  has_stunt: boolean;
  is_play_action: boolean;
  had_pressure: boolean;
  description: string;
  tag: string;
  headline: string;
  /** PLAN 2.6: seconds from snap to the end of the dropback (pass_forward / sack / run...). */
  ttt?: number | null;
  /** PLAN 2.6: event that ended the dropback (pass_forward, qb_sack, qb_strip_sack, run, fumble...). */
  endEvent?: string | null;
}

export interface TeamOlLane {
  lane: string;
  starter: string;
  starter_snaps: number;
  total_snaps: number;
  pressure_allowed_rate: number;
  beaten_rate: number;
  sacks_allowed: number;
  risk_level: 'HIGH' | 'MED' | 'LOW';
}

export interface TeamRusher {
  nflId: number;
  displayName: string;
  position: string;
  linedUp: string;
  snaps: number;
  pressures: number;
  sacks: number;
  dt_rate: number;
  press_rate: number;
  tm_press_when_dt: number;
}

/** PLAN 2.5: the team's main QB clock (late_share = % of dropbacks > 3.5 s). No per-QB early/late success (noise). */
export interface TeamQbClock {
  qb?: string;
  name?: string;
  plays?: number;
  late_share: number;
  ttt_median: number;
  league_late_share?: number;
  league_ttt_median?: number;
  league_drop?: number;
  league?: Partial<QbClocksLeague>;
}

export interface TeamGameplan {
  team: string;
  teamName: string;
  offense: {
    plays: number;
    pressure_allowed_rate: number;
    sack_rate: number;
    comp_rate: number;
    avg_yards: number;
    play_action_rate: number;
    play_action_yds?: number;
    straight_dropback_yds?: number;
    rollout_rate: number;
    stunt_pressure_allowed_rate?: number;
    ol_heatmap: TeamOlLane[];
    weakest_lane: TeamOlLane;
  };
  defense: {
    plays: number;
    pressure_rate: number;
    press_rate_4man: number;
    blitz_rate: number;
    stunt_rate: number;
    stunt_pressure_rate?: number;
    blitz_pressure_rate?: number;
    third_long_blitz_sack_rate?: number;
    sack_rate: number;
    avg_yards_allowed: number;
    top_rushers: TeamRusher[];
  };
  /** PLAN 2.5 additions */
  qb_clock?: TeamQbClock | null;
  /** Number (original contract) or object with the group-adjusted comparison (remote implementation). */
  def_getoff_avg?: number | { team_avg?: number; league_avg?: number; vs_group_avg?: number; snaps?: number; label?: string; stability?: number } | null;
  league_getoff_avg?: number | null;
  pa_rate?: number | null;
  attack_this_oline: string[];
  beat_this_defense: string[];
  featured_plays: PlaySummary[];
}

export interface PlayRosterMeta {
  nflId: number;
  name: string;
  officialPos: string;
  role: string;
  linedUp: string;
  blockType: string;
  blockedTarget: number | null;
  generatedPressure: boolean;
  sack: boolean;
  hit: boolean;
  hurry: boolean;
  allowedPressure: boolean;
  beaten: boolean;
  blockersAssigned: number;
  isDoubleTeamed: boolean;
  /** Legacy v1 (removed claim: "free rusher" is a PFF first-block artifact). Never render. */
  isFreeRusher?: boolean;
  /** PLAN 2.6: seconds from snap until this rusher moved 1 yard (null if not a rusher / no data). */
  getoff?: number | null;
}

export interface MatchupEdge {
  blockerId: number;
  rusherId: number;
  blockType: string;
  isDoubleTeam: boolean;
}

export interface FramePlayer {
  id: number;
  t: string;
  j: number;
  x: number;
  y: number;
  s: number;
  o: number;
  d: number;
}

export interface TrackingFrame {
  frameId: number;
  t: number;
  event: string;
  ball: { x: number; y: number } | null;
  qb: { x: number; y: number } | null;
  minDist: number;
  nearestRusherId: number | null;
  threat: 'CLEAN' | 'CLOSING' | 'COLLAPSE';
  players: FramePlayer[];
}

export interface TelemetryPoint {
  frameIndex: number;
  t: number;
  pocketRadius: number;
  closingSpeed: number;
  collapseRate: number;
  pocketArea: number;
  event: string;
}

export interface PlayTrackingData {
  play: PlaySummary;
  losX: number;
  firstDownX: number;
  viewBox: { xMin: number; xMax: number; yMin: number; yMax: number };
  roster: PlayRosterMeta[];
  matchups: MatchupEdge[];
  frames: TrackingFrame[];
  telemetry: TelemetryPoint[];
  keyEvents: { frameIndex: number; frameId: number; t: number; event: string }[];
  physicsSummary: {
    minPocketRadius: number;
    closestRusher: string;
    closestFrameIndex: number;
    peakCollapseVel: number;
    durationSec: number;
    doubleTeamedRushers: string[];
    /** Legacy v1 (removed claim). Never render. */
    freeRushers?: string[];
    pressureMakers: string[];
    coachingNotes: string[];
  };
}

export interface CoachBriefResponse {
  source: 'amazon_nova' | 'analytical_engine';
  model: string;
  brief: string;
}
