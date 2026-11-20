"""Optional Amazon Bedrock (Amazon Nova) Coaching Brief generator.

Strictly follows .hackathon/rules.md:
- Never reads/checks/requires AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN in code.
- Instantiates boto3.client("bedrock-runtime", region_name=region) only.
- Reads BEDROCK_MODEL_ID (default: us.amazon.nova-pro-v1:0) and AWS_REGION (default: us-east-1).
- Gracefully falls back to a deterministic, data-grounded coaching report if Bedrock is unavailable.
"""
from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.config import Config


def _deterministic_team_brief(gameplan: dict[str, Any]) -> str:
    team = gameplan["teamName"]
    off = gameplan["offense"]
    defn = gameplan["defense"]
    weak = off["weakest_lane"]
    top_r = defn["top_rushers"][0] if defn["top_rushers"] else None

    lines = [
        f"WAR-ROOM SCOUTING BRIEF — {team.upper()}",
        "",
        f"• ATTACKING {gameplan['team']}'S PASS PROTECTION: Their highest-risk lane is {weak['lane']} ({weak['starter']}), allowing {weak['pressure_allowed_rate']}% pressure and {weak['sacks_allowed']} sacks across {weak['total_snaps']} snaps. Against stunts/twists, their pressure allowed moves to {off['stunt_pressure_allowed_rate']}%, making 4-man games the highest-ROI pass-rush call.",
        f"• NEUTRALIZING {gameplan['team']}'S PASS RUSH: {gameplan['team']} generates {defn['press_rate_4man']}% pressure with just 4 rushers (blitzing {defn['blitz_rate']}% of the time)."
        + (f" Anchor protection slides toward {top_r['displayName']} ({top_r['pressures']} pressures, {top_r['sacks']} sacks, {top_r['dt_rate']}% double-team rate) without over-committing to two double-teams in 5-man sets." if top_r else ""),
        f"• PLAYCALLING LEVERAGE: {gameplan['team']}'s offense averages {off['play_action_yds']} yds/play on Play-Action vs {off['straight_dropback_yds']} yds/play on straight dropbacks (using rollouts on only {off['rollout_rate']}% of snaps—major untapped upside given the league's 1.1% rollout-right sack rate).",
        f"• SITUATIONAL TRIGGER: On 3rd & Long (7+), {gameplan['team']}'s defense converts blitzes into sacks {defn['third_long_blitz_sack_rate']}% of the time—have hot routes and 7-man max-protect answers scripted before Sunday.",
    ]
    return "\n".join(lines)


def _deterministic_play_brief(tracking: dict[str, Any]) -> str:
    p = tracking["play"]
    phys = tracking["physicsSummary"]
    lines = [
        f"FILM ROOM BREAKDOWN — {p['matchup']} (Q{p['quarter']} {p['gameClock']}, {p['down']} & {p['yardsToGo']})",
        "",
        f"• POCKET PHYSICS: Nearest rusher ({phys['closestRusher'] or 'pass rush'}) collapsed the QB pocket down to {phys['minPocketRadius']} yards at a peak closing rate of {phys['peakCollapseVel']} yds/sec across {phys['durationSec']}s.",
        f"• PROTECTION STRUCTURE: {p['n_blockers']} blockers vs {p['n_rushers']} rushers ({p['n_dt_rushers']} double-team(s), {p['n_free_rushers']} free rusher(s), {'Stunt/Twist active' if p['has_stunt'] else 'straight rush'}, {p['dropBackType']}).",
    ]
    for note in phys["coachingNotes"][:2]:
        lines.append(f"• COACHING TAKEAWAY: {note}")
    return "\n".join(lines)


def generate_coach_brief(
    mode: str,
    context_data: dict[str, Any],
    question: str = "",
) -> dict[str, Any]:
    """Call Amazon Nova Pro via Bedrock Converse API; fall back cleanly on any failure."""
    fallback_text = (
        _deterministic_team_brief(context_data)
        if mode == "team"
        else _deterministic_play_brief(context_data)
    )

    model_id = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
    region = os.environ.get("AWS_REGION", "us-east-1")

    if mode == "team":
        compact = {
            "team": context_data["teamName"],
            "offense": {
                k: v for k, v in context_data["offense"].items() if k != "ol_heatmap"
            },
            "ol_lanes": context_data["offense"]["ol_heatmap"],
            "defense": context_data["defense"],
        }
        system_prompt = (
            "You are an elite NFL Offensive & Defensive Coordinator analytics advisor. "
            "Given verified 2021 NFL tracking + PFF pass-rush metrics, write a razor-sharp "
            "4-bullet Sunday Gameplan Brief (max 140 words) with concrete numbers and tactical calls. "
            "No fluff, no markdown headers—just crisp bullet points starting with '•'."
        )
    else:
        compact = {
            "play": context_data["play"],
            "physics": context_data["physicsSummary"],
        }
        system_prompt = (
            "You are an NFL Film Room coach analyzing 10Hz tracking and PFF trench matchups. "
            "Write a sharp 4-bullet coaching breakdown (max 130 words) explaining WHY the pocket held "
            "or collapsed and what adjustment the coach should make next drive. Use exact numbers."
        )

    user_prompt = f"Metrics JSON:\n{json.dumps(compact, ensure_ascii=False)}"
    if question.strip():
        user_prompt += f"\n\nCoach's specific question: {question.strip()}"

    try:
        cfg = Config(connect_timeout=2, read_timeout=6, retries={"max_attempts": 1})
        client = boto3.client("bedrock-runtime", region_name=region, config=cfg)
        resp = client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_prompt}]}],
            inferenceConfig={"maxTokens": 320, "temperature": 0.3},
        )
        content = resp.get("output", {}).get("message", {}).get("content", [])
        text = "".join(part.get("text", "") for part in content).strip()
        if text:
            return {"source": "amazon_nova", "model": model_id, "brief": text}
    except Exception:
        pass

    return {"source": "analytical_engine", "model": "deterministic-fallback", "brief": fallback_text}
