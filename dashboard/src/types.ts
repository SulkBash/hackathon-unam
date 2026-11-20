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
}

export interface OverviewData {
  summary: OverviewSummary;
  pressure_impact: PressureImpactRow[];
  dt_paradox: DtParadoxRow[];
  gravity_lift: GravityLiftRow[];
  stunt_impact: StuntImpactRow[];
  dropback_counters: DropbackCounterRow[];
  protection_tiers: ProtectionTierRow[];
  blitz_situations: BlitzSituationRow[];
  block_schemes: BlockSchemeRow[];
  ol_lanes: OlLaneRow[];
  team_matrix: TeamMatrixRow[];
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

export interface PlayersData {
  defenders: GravityDefender[];
  linemen: IronLineman[];
  qbs: QbPoiseRow[];
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
  n_dt_rushers: number;
  n_free_rushers: number;
  has_stunt: boolean;
  is_play_action: boolean;
  had_pressure: boolean;
  description: string;
  tag: string;
  headline: string;
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
    play_action_yds: number;
    straight_dropback_yds: number;
    rollout_rate: number;
    stunt_pressure_allowed_rate: number;
    ol_heatmap: TeamOlLane[];
    weakest_lane: TeamOlLane;
  };
  defense: {
    plays: number;
    pressure_rate: number;
    press_rate_4man: number;
    blitz_rate: number;
    stunt_rate: number;
    stunt_pressure_rate: number;
    blitz_pressure_rate: number;
    third_long_blitz_sack_rate: number;
    sack_rate: number;
    avg_yards_allowed: number;
    top_rushers: TeamRusher[];
  };
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
  isFreeRusher: boolean;
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
    freeRushers: string[];
    pressureMakers: string[];
    coachingNotes: string[];
  };
}

export interface CoachBriefResponse {
  source: 'amazon_nova' | 'analytical_engine';
  model: string;
  brief: string;
}
