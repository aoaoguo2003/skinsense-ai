import base64
import json
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_provider: str = "anthropic"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openweather_api_key: str = ""
    frontend_url: str = "http://localhost:3000"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()

SYSTEM_PROMPT = """You are a professional dermatologist and beauty consultant with expertise in skincare science, cosmetic chemistry, and personalized beauty recommendations.

Your analysis must be:
- Evidence-based and scientifically grounded
- Personalized to the specific user's skin concerns, type, and environmental conditions
- Practical with real, commercially available products
- Honest about ingredient interactions and potential conflicts

IMPORTANT: Respond entirely in Simplified Chinese (简体中文). Every text field in the JSON must be written in Chinese.

Always respond in valid JSON format as specified."""


def _build_analysis_prompt(
    questionnaire: dict,
    weather: Optional[dict],
    current_products: Optional[list[str]],
    has_image: bool,
) -> str:
    parts = []

    parts.append("## User Skin Profile (Questionnaire)\n")
    for k, v in questionnaire.items():
        parts.append(f"- **{k}**: {v}")

    if weather:
        parts.append(f"\n## Local Weather & Climate\n- Location: {weather.get('city', 'Unknown')}")
        parts.append(f"- Temperature: {weather.get('temp_c', '?')}°C")
        parts.append(f"- Humidity: {weather.get('humidity', '?')}%")
        parts.append(f"- Weather: {weather.get('description', '?')}")
        parts.append(f"- UV Index: {weather.get('uv_index', 'Unknown')}")

    if current_products:
        parts.append("\n## User's Current Products\n" + "\n".join(f"- {p}" for p in current_products))

    if has_image:
        parts.append("\n## Note\nA facial photo has been provided. Analyze the visible skin condition, tone, texture, and any visible concerns from the image.")

    parts.append("""
## Required Response Format (JSON)

Return ONLY valid JSON with this exact structure:
```json
{
  "skin_analysis": {
    "skin_type": "string (oily/dry/combination/sensitive/normal)",
    "skin_tone": "string (fair/light/medium/tan/deep)",
    "main_concerns": ["list of identified concerns"],
    "condition_score": 1-10,
    "summary": "2-3 sentence analysis"
  },
  "weather_adjustment": {
    "recommendation": "详细说明当前天气/气候如何影响该用户的肌肤状态，需具体说明温度、湿度、紫外线的影响",
    "key_considerations": ["至少4条具体的天气适配护肤建议"]
  },
  "concern_solutions": [
    {
      "concern": "皮肤问题名称（与用户填写的保持一致）",
      "analysis": "该问题的成因分析（2句话，结合用户肤质特点和当前天气环境）",
      "targeted_solution": "针对此问题的具体护肤步骤和改善方案（2-3句话，提及可使用的成分或产品类型）",
      "key_ingredients": ["对此问题最有效的核心成分1", "成分2", "成分3"],
      "weather_impact": "当前气候条件对此问题的影响及针对性应对策略（1句话）"
    }
  ],
  "product_recommendations": [
    {
      "category": "e.g. Cleanser / Serum / Moisturizer / Sunscreen / Toner",
      "product_name": "Real brand + product name",
      "brand": "Brand name",
      "price_range": "$ / $$ / $$$ / $$$$",
      "why_recommended": "Personalized reason for this user",
      "key_ingredients": [
        {
          "name": "Ingredient name",
          "benefit": "What it does for this user's specific concern",
          "concentration_note": "Any notes on concentration or usage"
        }
      ],
      "usage": "How/when to use",
      "purchase_tip": "Where to buy or what to look for"
    }
  ],
  "ingredient_conflicts": {
    "current_product_issues": [
      {
        "products_involved": ["Product A", "Product B"],
        "conflicting_ingredients": ["ingredient1", "ingredient2"],
        "issue": "Explanation of the conflict",
        "severity": "mild/moderate/severe",
        "recommendation": "What to do about it"
      }
    ],
    "recommended_synergies": [
      {
        "ingredients": ["ingredient1", "ingredient2"],
        "synergy": "How these work together positively"
      }
    ],
    "timing_guide": {
      "morning_routine": ["Step 1: ...", "Step 2: ..."],
      "evening_routine": ["Step 1: ...", "Step 2: ..."]
    }
  },
  "lifestyle_tips": ["List of 3-5 personalized tips based on weather and skin analysis"]
}
```""")

    return "\n".join(parts)


async def analyze_with_claude(
    questionnaire: dict,
    weather: Optional[dict],
    current_products: Optional[list[str]],
    image_bytes: Optional[bytes],
    image_media_type: Optional[str],
) -> dict:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    prompt = _build_analysis_prompt(questionnaire, weather, current_products, image_bytes is not None)

    content = []
    if image_bytes:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image_media_type or "image/jpeg",
                "data": base64.standard_b64encode(image_bytes).decode("utf-8"),
            },
        })
    content.append({"type": "text", "text": prompt})

    response = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content}],
    )

    raw = response.content[0].text
    # Strip markdown code fences if present
    if "```json" in raw:
        raw = raw.split("```json")[1].split("```")[0].strip()
    elif "```" in raw:
        raw = raw.split("```")[1].split("```")[0].strip()

    return json.loads(raw)


async def analyze_with_openai(
    questionnaire: dict,
    weather: Optional[dict],
    current_products: Optional[list[str]],
    image_bytes: Optional[bytes],
    image_media_type: Optional[str],
) -> dict:
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=settings.openai_api_key)

    prompt = _build_analysis_prompt(questionnaire, weather, current_products, image_bytes is not None)

    content = []
    if image_bytes:
        b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
        mime = image_media_type or "image/jpeg"
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
        })
    content.append({"type": "text", "text": prompt})

    response = await client.chat.completions.create(
        model="gpt-4o",
        max_tokens=4096,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": content},
        ],
        response_format={"type": "json_object"},
    )

    return json.loads(response.choices[0].message.content)


async def analyze_skin(
    questionnaire: dict,
    weather: Optional[dict] = None,
    current_products: Optional[list[str]] = None,
    image_bytes: Optional[bytes] = None,
    image_media_type: Optional[str] = None,
) -> dict:
    if settings.llm_provider == "openai":
        return await analyze_with_openai(questionnaire, weather, current_products, image_bytes, image_media_type)
    return await analyze_with_claude(questionnaire, weather, current_products, image_bytes, image_media_type)
