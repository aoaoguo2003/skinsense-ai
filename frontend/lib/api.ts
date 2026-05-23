import { AnalyzeResponse, Questionnaire } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export async function searchProductImage(productName: string, brand: string): Promise<string | null> {
  const q = `${productName} ${brand} skincare product`;
  try {
    const res = await fetch(`${API_BASE}/api/image?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.image_url) return null;
    // If backend returns a proxy path, prepend API_BASE
    if (data.image_url.startsWith("/api/")) return `${API_BASE}${data.image_url}`;
    return data.image_url;
  } catch {
    return null;
  }
}
