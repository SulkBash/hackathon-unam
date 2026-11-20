"""Resumen opcional con Amazon Bedrock (Amazon Nova) + respaldo determinista en español.

Sigue .hackathon/rules.md:
- Nunca lee, verifica ni exige AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN.
- Crea el cliente solo con la región: boto3.client("bedrock-runtime", region_name=region).
- Lee BEDROCK_MODEL_ID (por omisión us.amazon.nova-pro-v1:0) y AWS_REGION (por omisión us-east-1).
- Si Bedrock no está disponible, devuelve un resumen determinista construido con los mismos datos verificados.
"""
from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.config import Config

END_ES = {
    "pass_forward": "lanzamiento",
    "pass_shovel": "lanzamiento",
    "qb_sack": "sack",
    "qb_strip_sack": "sack con balón suelto",
    "run": "scramble",
    "fumble": "balón suelto",
}


def _deterministic_team_brief(gameplan: dict[str, Any]) -> str:
    team = gameplan.get("teamName") or gameplan.get("team", "")
    lines = [f"Resumen del coordinador: {team}", ""]
    attack = gameplan.get("attack_this_oline") or []
    beat = gameplan.get("beat_this_defense") or []
    if attack:
        lines.append("Cuando tu defensa enfrenta a su ofensiva:")
        lines += [f"• {h}" for h in attack]
    if beat:
        if attack:
            lines.append("")
        lines.append("Cuando tu ofensiva enfrenta a su defensa:")
        lines += [f"• {h}" for h in beat]
    if not attack and not beat:
        weak = (gameplan.get("offense") or {}).get("weakest_lane") or {}
        if weak:
            lines.append(
                f"• Ataca el carril {weak.get('lane')} ({weak.get('starter')}): permitió presión en "
                f"{weak.get('pressure_allowed_rate')}% de {weak.get('total_snaps')} bloqueos. Tendencia de 8 semanas."
            )
    return "\n".join(lines)


def _deterministic_play_brief(tracking: dict[str, Any]) -> str:
    p = tracking.get("play", {})
    phys = tracking.get("physicsSummary", {})
    ttt = p.get("ttt")
    end = END_ES.get(str(p.get("endEvent")), "fin del dropback")
    lines = [
        f"Sala de Video: {p.get('matchup', '')} (cuarto {p.get('quarter')}, {p.get('gameClock')}, {p.get('down')} y {p.get('yardsToGo')})",
        "",
    ]
    if ttt is not None:
        zona = "después de 3.5 s, en la zona de peligro" if ttt > 3.5 else "antes de 3.5 s"
        lines.append(f"• Reloj: {end} a los {ttt} s, {zona}.")
    lines.append(
        f"• Protección: {p.get('n_blockers')} bloqueadores contra {p.get('n_rushers')} rushers"
        f"{', con stunt' if p.get('has_stunt') else ''}{', con play action' if p.get('is_play_action') else ''}."
    )
    rushers = [r for r in tracking.get("roster", []) if r.get("role") == "Pass Rush" and r.get("getoff") is not None]
    if rushers:
        fastest = min(rushers, key=lambda r: r["getoff"])
        lines.append(f"• Arranque más rápido: {fastest.get('name')} en {fastest['getoff']:.2f} s.")
    if phys.get("closestRusher"):
        lines.append(f"• El rusher que más se acercó: {phys.get('closestRusher')} (pocket mínimo de {phys.get('minPocketRadius')} yardas).")
    return "\n".join(lines)


def _team_compact(ctx: dict[str, Any]) -> dict[str, Any]:
    off = ctx.get("offense") or {}
    return {
        "equipo": ctx.get("teamName"),
        "pistas_verificadas_defensa": ctx.get("attack_this_oline"),
        "pistas_verificadas_ofensiva": ctx.get("beat_this_defense"),
        "reloj_qb": ctx.get("qb_clock"),
        "get_off_defensa_vs_liga": {"equipo": ctx.get("def_getoff_avg"), "liga": ctx.get("league_getoff_avg")},
        "uso_play_action": ctx.get("pa_rate"),
        "carriles_linea_ofensiva": off.get("ol_heatmap"),
        "defensa": {k: v for k, v in (ctx.get("defense") or {}).items() if k != "top_rushers"},
        "rushers_principales": (ctx.get("defense") or {}).get("top_rushers"),
    }


def generate_coach_brief(
    mode: str,
    context_data: dict[str, Any],
    question: str = "",
) -> dict[str, Any]:
    """Llama a Amazon Nova (Bedrock Converse); si algo falla, devuelve el resumen determinista."""
    fallback_text = (
        _deterministic_team_brief(context_data) if mode == "team" else _deterministic_play_brief(context_data)
    )

    model_id = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")
    region = os.environ.get("AWS_REGION", "us-east-1")

    rules = (
        "Responde en español, en 4 viñetas que empiecen con '•' (máximo 130 palabras), sin encabezados ni markdown. "
        "Usa solo los números del JSON; no inventes cifras. Si una pista dice 'muestra chica' o 'tendencia', consérvalo. "
        "No digas que el blitz en 3ro y largo es un golpe de gracia, no hables de 'rusher libre' ni describas los 3.5 s como un muro."
    )
    if mode == "team":
        compact = _team_compact(context_data)
        system_prompt = (
            "Eres asesor analítico de un coordinador de la NFL. Con métricas verificadas de tracking y PFF (2021, semanas 1–8), "
            "escribe el plan de juego para el domingo contra este equipo. " + rules
        )
    else:
        compact = {
            "jugada": context_data.get("play"),
            "fisica_del_pocket": context_data.get("physicsSummary"),
            "rushers": [
                {k: r.get(k) for k in ("name", "officialPos", "getoff", "generatedPressure", "sack")}
                for r in context_data.get("roster", [])
                if r.get("role") == "Pass Rush"
            ],
        }
        system_prompt = (
            "Eres entrenador de la Sala de Video. Con tracking a 10 Hz y PFF, explica por qué el pocket aguantó o se cerró "
            "y qué ajuste conviene en la siguiente serie. " + rules
        )

    user_prompt = f"JSON de métricas:\n{json.dumps(compact, ensure_ascii=False)}"
    if question.strip():
        user_prompt += f"\n\nPregunta del coordinador: {question.strip()}"

    try:
        cfg = Config(connect_timeout=2, read_timeout=6, retries={"max_attempts": 1})
        client = boto3.client("bedrock-runtime", region_name=region, config=cfg)
        resp = client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[{"role": "user", "content": [{"text": user_prompt}]}],
            inferenceConfig={"maxTokens": 360, "temperature": 0.3},
        )
        content = resp.get("output", {}).get("message", {}).get("content", [])
        text = "".join(part.get("text", "") for part in content).strip()
        if text:
            return {"source": "amazon_nova", "model": model_id, "brief": text}
    except Exception:
        pass

    return {"source": "analytical_engine", "model": "deterministic-fallback", "brief": fallback_text}
