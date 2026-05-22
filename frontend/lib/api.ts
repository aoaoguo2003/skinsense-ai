import { AnalyzeResponse, Questionnaire } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function analyzeSkin(params: {
  questionnaire: Questionnaire;
  currentProducts?: string[];
  city?: string;
  latitude?: number;
  longitude?: number;
  image?: File | null;
}): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.append("questionnaire", JSON.stringify(params.questionnaire));

  if (params.currentProducts?.length) {
    form.append("current_products", JSON.stringify(params.currentProducts));
  }
  if (params.city) form.append("city", params.city);
  if (params.latitude != null) form.append("latitude", String(params.latitude));
  if (params.longitude != null) form.append("longitude", String(params.longitude));
  if (params.image) form.append("image", params.image);

  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Server error ${res.status}`);
  }

  return res.json();
}
