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
        lines.append("")
        lines.append(
            f"• Get-off de su línea defensiva: {dg['team_avg']} s de promedio (liga {dg['league_avg']} s; "
            f"{dg['vs_group_avg']:+.3f} s vs el promedio de su grupo de posición). Tendencia, no rasgo fijo."
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
    lines = [
        f"SALA DE VIDEO: {p['matchup']} (Q{p['quarter']} {p['gameClock']}, {p['down']}° y {p['yardsToGo']})",
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
            "Responde en español. Eres asesor de análisis de un coordinador de la NFL. La tesis es "
            "'La Guerra de los 3.5 Segundos': cada pase es una carrera entre el reloj del quarterback y el de los "
            "pass rushers. Con las métricas verificadas (NFL 2021, semanas 1-8) escribe un plan de juego de 4 viñetas "
            "(máximo 140 palabras), cada una empezando con '•', con números concretos y decisiones tácticas. "
            "Usa SOLO los números del JSON; no inventes cifras. Las métricas marcadas como tendencia o muestra chica "
            "deben decirlo. No digas que el play action sube el éxito (su ventaja es la jugada grande) y no llames "
            "'precipicio' a los 3.5 s (es una zona de peligro)."
        )
    else:
        compact = {"jugada": context_data["play"], "fisica": context_data["physicsSummary"]}
        system_prompt = (
            "Responde en español. Eres coach de la sala de video de la NFL y analizas tracking a 10 Hz y datos de PFF. "
            "Escribe 4 viñetas (máximo 130 palabras), cada una empezando con '•', que expliquen POR QUÉ el pocket "
            "aguantó o se cerró (reloj del QB, get-off de los rushers, protección) y qué ajuste hacer en la siguiente "
            "serie. Usa SOLO los números del JSON; no inventes cifras."
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
