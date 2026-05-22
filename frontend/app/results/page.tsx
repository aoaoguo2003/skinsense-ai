"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Sparkles, CloudSun, FlaskConical, AlertTriangle, CheckCircle2,
  Sun, Moon, ArrowLeft, Leaf, DollarSign, ShoppingBag
} from "lucide-react";
import { AnalyzeResponse, ProductRecommendation, IngredientConflict } from "@/lib/types";

const SEVERITY_COLOR: Record<string, string> = {
  mild: "text-yellow-600 bg-yellow-50 border-yellow-200",
  moderate: "text-orange-600 bg-orange-50 border-orange-200",
  severe: "text-red-600 bg-red-50 border-red-200",
};

const PRICE_LABEL: Record<string, string> = {
  "$": "经济",
  "$$": "中档",
  "$$$": "高端",
  "$$$$": "奢华",
};

function ScoreRing({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={r} fill="none" stroke="#f3f4f6" strokeWidth="8" />
      <circle
        cx="45" cy="45" r={r} fill="none"
        stroke="url(#grad)" strokeWidth="8"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 45 45)"
      />
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="100%" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <text x="45" y="49" textAnchor="middle" fontSize="18" fontWeight="700" fill="#111">{score}</text>
      <text x="45" y="61" textAnchor="middle" fontSize="9" fill="#9ca3af">/10</text>
    </svg>
  );
}

function ProductCard({ product }: { product: ProductRecommendation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <span className="text-xs font-medium text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">{product.category}</span>
            <h4 className="font-semibold text-gray-900 mt-2 text-base">{product.product_name}</h4>
            <p className="text-sm text-gray-500">{product.brand}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 text-xs text-gray-500 font-medium">
              <DollarSign className="w-3 h-3" />
              {PRICE_LABEL[product.price_range] || product.price_range}
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-3 leading-relaxed">{product.why_recommended}</p>
        <p className="text-xs text-gray-400 mt-2">
          <span className="font-medium text-gray-500">用法：</span>{product.usage}
        </p>
      </div>

      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 text-sm text-rose-600 font-medium border-t border-gray-50 hover:bg-rose-50 transition-colors text-left flex items-center gap-1"
      >
        <FlaskConical className="w-4 h-4" />
        {open ? "收起" : "查看"} 关键成分解析
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3">
          {product.key_ingredients.map((ing, i) => (
            <div key={i} className="bg-fuchsia-50 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-1">
                <Leaf className="w-3.5 h-3.5 text-fuchsia-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-800">{ing.name}</span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{ing.benefit}</p>
              {ing.concentration_note && (
                <p className="text-xs text-fuchsia-500 mt-1">{ing.concentration_note}</p>
              )}
            </div>
          ))}
          {product.purchase_tip && (
            <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 rounded-xl p-3">
              <ShoppingBag className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{product.purchase_tip}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConflictCard({ conflict }: { conflict: IngredientConflict }) {
  return (
    <div className={`rounded-xl border p-4 ${SEVERITY_COLOR[conflict.severity]}`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm font-semibold">
          {conflict.severity === "mild" ? "轻微" : conflict.severity === "moderate" ? "中度" : "严重"} 冲突
        </span>
      </div>
      <p className="text-xs font-medium mb-1">相关产品：{conflict.products_involved.join(" + ")}</p>
      <p className="text-xs mb-1">冲突成分：<span className="font-medium">{conflict.conflicting_ingredients.join("、")}</span></p>
      <p className="text-xs mb-2 leading-relaxed">{conflict.issue}</p>
      <p className="text-xs font-medium">建议：{conflict.recommendation}</p>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyzeResponse | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("skinsense_result");
    if (!raw) { router.replace("/analyze"); return; }
    try { setData(JSON.parse(raw)); } catch { router.replace("/analyze"); }
  }, [router]);

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center bg-rose-50">
      <div className="w-8 h-8 border-4 border-rose-300 border-t-rose-500 rounded-full animate-spin" />
    </div>
  );

  const { analysis, weather } = data;
  const { skin_analysis, weather_adjustment, product_recommendations, ingredient_conflicts, lifestyle_tips } = analysis;

  return (
    <main className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/analyze" className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm hover:shadow-md transition-shadow">
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">你的专属肌肤报告</h1>
            {weather && (
              <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
                <CloudSun className="w-3.5 h-3.5" />
                {weather.city}, {weather.country} · {weather.temp_c}°C · 湿度 {weather.humidity}%
              </p>
            )}
          </div>
        </div>

        {/* Skin Analysis */}
        <div className="bg-white rounded-3xl shadow-sm p-6">
          <div className="flex items-start gap-6">
            <ScoreRing score={skin_analysis.condition_score} />
            <div className="flex-1">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  {skin_analysis.skin_type}
                </span>
                <span className="bg-gray-100 text-gray-600 text-xs font-medium px-3 py-1 rounded-full">
                  肤色：{skin_analysis.skin_tone}
                </span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{skin_analysis.summary}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {skin_analysis.main_concerns.map((c, i) => (
                  <span key={i} className="text-xs bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded-full">{c}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Weather Adjustment */}
        {weather_adjustment && (
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CloudSun className="w-5 h-5 text-sky-500" />
              <h3 className="font-semibold text-gray-900">天气适配建议</h3>
            </div>
            <p className="text-sm text-gray-600 mb-3 leading-relaxed">{weather_adjustment.recommendation}</p>
            <ul className="space-y-1">
              {weather_adjustment.key_considerations.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-sky-700">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Product Recommendations */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-rose-500" />
            <h2 className="text-xl font-bold text-gray-900">个性化产品推荐</h2>
          </div>
          <div className="space-y-4">
            {product_recommendations.map((p, i) => <ProductCard key={i} product={p} />)}
          </div>
        </div>

        {/* Ingredient Conflicts */}
        {ingredient_conflicts.current_product_issues.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              <h2 className="text-xl font-bold text-gray-900">成分冲突提醒</h2>
            </div>
            <div className="space-y-3">
              {ingredient_conflicts.current_product_issues.map((c, i) => (
                <ConflictCard key={i} conflict={c} />
              ))}
            </div>
          </div>
        )}

        {/* Synergies */}
        {ingredient_conflicts.recommended_synergies.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <FlaskConical className="w-5 h-5 text-emerald-500" />
              <h3 className="font-semibold text-gray-900">成分协同效果</h3>
            </div>
            <div className="space-y-3">
              {ingredient_conflicts.recommended_synergies.map((s, i) => (
                <div key={i} className="bg-white rounded-xl p-3">
                  <p className="text-xs font-semibold text-emerald-700 mb-1">{s.ingredients.join(" + ")}</p>
                  <p className="text-xs text-gray-600 leading-relaxed">{s.synergy}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Routine Guide */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Sun className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-gray-900">早间护肤步骤</h3>
            </div>
            <ol className="space-y-2">
              {ingredient_conflicts.timing_guide.morning_routine.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="w-4 h-4 bg-amber-200 text-amber-700 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Moon className="w-4 h-4 text-indigo-500" />
              <h3 className="font-semibold text-gray-900">晚间护肤步骤</h3>
            </div>
            <ol className="space-y-2">
              {ingredient_conflicts.timing_guide.evening_routine.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="w-4 h-4 bg-indigo-200 text-indigo-700 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Lifestyle Tips */}
        {lifestyle_tips.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Leaf className="w-4 h-4 text-green-500" /> 生活习惯小贴士
            </h3>
            <ul className="space-y-2">
              {lifestyle_tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="text-center pb-8">
          <Link
            href="/analyze"
            className="inline-flex items-center gap-2 text-sm text-rose-500 hover:text-rose-600 font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> 重新检测
          </Link>
        </div>
      </div>
    </main>
  );
}
