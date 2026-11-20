"""Resumen opcional del coordinador con Amazon Bedrock (Amazon Nova) + respaldo determinista.

Sigue .hackathon/rules.md:
- No lee, verifica ni exige AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN.
- Crea el cliente solo con la región: boto3.client("bedrock-runtime", region_name=region).
- Lee BEDROCK_MODEL_ID (por defecto us.amazon.nova-pro-v1:0) y AWS_REGION (por defecto us-east-1).
- Si Bedrock falla o no está disponible, devuelve un resumen determinista construido con los datos.
"""
from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.config import Config


def _deterministic_team_brief(gameplan: dict[str, Any]) -> str:
    off = gameplan["offense"]
    defn = gameplan["defense"]
    lines = [f"RESUMEN DEL COORDINADOR: {gameplan['teamName'].upper()}", ""]
    lines.append("Si tu defensa enfrenta a esta ofensiva:")
    lines += [f"• {h}" for h in gameplan["attack_this_oline"]]
    lines.append("")
    lines.append("Si tu ofensiva enfrenta a esta defensa:")
    lines += [f"• {h}" for h in gameplan["beat_this_defense"]]
    dg = defn.get("def_getoff", {})
    if dg.get("snaps"):
        rel_s = dg["vs_group_avg"]
        rel_dir = "más rápido" if rel_s < 0 else ("más lento" if rel_s > 0 else "en el promedio")
        lines.append("")
        lines.append(
            f"• Get-off defensivo: {dg['team_avg']} s de promedio (liga {dg['league_avg']} s; "
            f"{rel_s:+.3f} s vs grupo, {rel_dir}; tendencia de equipo)."
        )
    lines.append(
        f"• Contexto: {off['plays']} pases de su ofensiva (presión permitida {off['pressure_allowed_rate']}%), "
        f"{defn['plays']} pases enfrentados por su defensa (presión generada {defn['pressure_rate']}%)."
    )
    return "\n".join(lines)


def _deterministic_play_brief(tracking: dict[str, Any]) -> str:
    p = tracking["play"]
    phys = tracking["physicsSummary"]
    plan = ("blitz" if p.get("is_blitz") else f"rush de {p['n_rushers']}") + (" con stunt" if p["has_stunt"] else "")
    sit = "Conversión de 2 pts" if p["down"] == 0 else f"{p['down']}° y {p['yardsToGo']}"
    lines = [
        f"SALA DE VIDEO: {p['matchup']} (Q{p['quarter']} {p['gameClock']}, {sit})",
        "",
        f"• Estructura: {p['n_blockers']} bloqueadores contra {p['n_rushers']} rushers ({plan}"
        f"{', play action' if p['is_play_action'] else ''}).",
    ]
    lines += [f"• {note}" for note in phys["coachingNotes"]]
    return "\n".join(lines)


def generate_coach_brief(mode: str, context_data: dict[str, Any], question: str = "") -> dict[str, Any]:
    """Call Amazon Nova via the Bedrock Converse API; fall back cleanly on any failure."""
    fallback_text = (
        _deterministic_team_brief(context_data) if mode == "team" else _deterministic_play_brief(context_data)
    )

    model_id = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
    region = os.environ.get("AWS_REGION", "us-east-1")

    if mode == "team":
        off = context_data["offense"]
        compact = {
            "equipo": context_data["teamName"],
            "ofensiva": {k: v for k, v in off.items() if k not in ("ol_heatmap", "weakest_lane")},
            "carriles_linea_ofensiva": off["ol_heatmap"],
            "reloj_qb": context_data.get("qb_clock"),
            "defensa": context_data["defense"],
            "pistas_verificadas_defensa": context_data["attack_this_oline"],
            "pistas_verificadas_ofensiva": context_data["beat_this_defense"],
        }
        system_prompt = (
            "Responde en español con tono directo, sobrio y técnico (sin frases hechas ni adornos). Eres analista "
            "de un cuerpo técnico de la NFL. Con las métricas verificadas (NFL 2021, semanas 1-8) redacta 4 viñetas "
            "(máximo 140 palabras), cada una empezando con '•', con números concretos y ajustes tácticos. "
            "Usa SOLO las cifras del JSON; no inventes datos. Indica cuando una métrica sea tendencia o muestra chica. "
            "No digas que el play action sube el éxito (su efecto está en jugadas de 20+ yd) ni presentes los 3.5 s "
            "como un salto abrupto."
        )
    else:
        compact = {"jugada": context_data["play"], "fisica": context_data["physicsSummary"]}
        system_prompt = (
            "Responde en español con tono directo y técnico, sin frases hechas. Analizas una jugada de NFL con tracking "
            "a 10 Hz y PFF Scouting. Redacta 4 viñetas (máximo 130 palabras), cada una empezando con '•', explicando "
            "por qué el pocket resistió o cedió (reloj del QB, get-off, protección) y qué ajuste conviene en la "
            "siguiente serie. Usa SOLO los números del JSON."
        )

    user_prompt = f"Métricas JSON:\n{json.dumps(compact, ensure_ascii=False)}"
    if question.strip():
        user_prompt += f"\n\nPregunta específica del coach: {question.strip()}"

    try:
        cfg = Config(connect_timeout=2, read_timeout=8, retries={"max_attempts": 1})
        client = boto3.client("bedrock-runtime", region_name=region, config=cfg)
        resp = client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_prompt}]}],
            inferenceConfig={"maxTokens": 400, "temperature": 0.3},
        )
        content = resp.get("output", {}).get("message", {}).get("content", [])
        text = "".join(part.get("text", "") for part in content).strip()
        if text:
            return {"source": "amazon_nova", "model": model_id, "brief": text}
    except Exception:
        pass

    return {"source": "analytical_engine", "model": "deterministic-fallback", "brief": fallback_text}
