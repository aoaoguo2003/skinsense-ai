"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Camera, Upload, X, MapPin, Plus, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { analyzeSkin } from "@/lib/api";
import { Questionnaire } from "@/lib/types";

const SKIN_TYPES = ["油性", "干性", "混合性", "敏感性", "中性"];
const SKIN_CONCERNS = ["痘痘/粉刺", "黑头", "毛孔粗大", "细纹/皱纹", "色斑/暗沉", "红血丝", "泛红敏感", "黑眼圈", "干燥脱皮", "出油过多"];
const AGE_RANGES = ["18岁以下", "18-24岁", "25-34岁", "35-44岁", "45-54岁", "55岁以上"];
const MAX_BUDGET = 2000;
const BUDGET_STEP = 50;
const TEXTURES = ["清爽水感", "轻薄乳液", "普通乳霜", "厚重滋润", "无偏好"];
const FRAGRANCES = ["偏好有香味", "偏好无香", "无所谓"];
const SENSITIVITY = ["非常敏感", "轻微敏感", "不敏感"];

interface FormState {
  step: number;
  skinType: string;
  skinConcerns: string[];
  sensitivity: string;
  ageRange: string;
  gender: string;
  budgetMin: number;
  budgetMax: number;
  texture: string;
  avoidIngredients: string;
  fragrance: string;
  currentProducts: string[];
  newProduct: string;
  otherConcern: string;
  city: string;
  useGPS: boolean;
  latitude?: number;
  longitude?: number;
  image: File | null;
  imagePreview: string | null;
}

export default function AnalyzePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<FormState>({
    step: 1,
    skinType: "",
    skinConcerns: [],
    sensitivity: "",
    ageRange: "",
    gender: "",
    budgetMin: 0,
    budgetMax: 500,
    texture: "",
    avoidIngredients: "",
    fragrance: "",
    currentProducts: [],
    newProduct: "",
    otherConcern: "",
    city: "",
    useGPS: false,
    image: null,
    imagePreview: null,
  });

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const toggleConcern = (c: string) => {
    update({
      skinConcerns: form.skinConcerns.includes(c)
        ? form.skinConcerns.filter((x) => x !== c)
        : [...form.skinConcerns, c],
    });
  };

  const addProduct = () => {
    const p = form.newProduct.trim();
    if (p && !form.currentProducts.includes(p)) {
      update({ currentProducts: [...form.currentProducts, p], newProduct: "" });
    }
  };

  const removeProduct = (p: string) => update({ currentProducts: form.currentProducts.filter((x) => x !== p) });

  const handleImage = (file: File) => {
    const url = URL.createObjectURL(file);
    update({ image: file, imagePreview: url });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleImage(file);
  }, []);

  const detectGPS = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => update({ useGPS: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => update({ useGPS: false })
    );
  };

  const canNext = () => {
    if (form.step === 1) return !!form.skinType && !!form.sensitivity;
    if (form.step === 2) return form.skinConcerns.length > 0 && !!form.ageRange;
    return true;
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const skinConcerns = form.skinConcerns.map((c) =>
        c === "其他" && form.otherConcern.trim() ? `其他：${form.otherConcern.trim()}` : c
      );
      const questionnaire: Questionnaire = {
        skin_type: form.skinType,
        skin_concerns: skinConcerns,
        skin_sensitivity: form.sensitivity,
        age_range: form.ageRange,
        gender: form.gender || "未指定",
        budget: `¥${form.budgetMin}-${form.budgetMax >= MAX_BUDGET ? MAX_BUDGET + "以上" : form.budgetMax}（每件）`,
        preferred_texture: form.texture || "无偏好",
        avoid_ingredients: form.avoidIngredients || "无",
        fragrance_preference: form.fragrance || "无所谓",
        environment: form.city || "未知",
      };

      const result = await analyzeSkin({
        questionnaire,
        currentProducts: form.currentProducts,
        city: form.useGPS ? undefined : form.city || undefined,
        latitude: form.useGPS ? form.latitude : undefined,
        longitude: form.useGPS ? form.longitude : undefined,
        image: form.image,
      });

      sessionStorage.setItem("skinsense_result", JSON.stringify(result));
      router.push("/results");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "分析失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                form.step >= s ? "bg-gradient-to-br from-rose-500 to-fuchsia-500 text-white" : "bg-white text-gray-400 border"
              }`}>
                {s}
              </div>
              {s < 3 && <div className={`flex-1 h-1 w-16 rounded ${form.step > s ? "bg-rose-300" : "bg-gray-200"}`} />}
            </div>
          ))}
          <span className="ml-auto text-sm text-gray-500">
            {form.step === 1 ? "基本肤质" : form.step === 2 ? "皮肤关注" : "照片与位置"}
          </span>
        </div>

        <div className="bg-white/80 backdrop-blur rounded-3xl shadow-lg p-8">

          {/* Step 1: Skin type + sensitivity */}
          {form.step === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">你的肤质是？</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">肤质类型</label>
                <div className="flex flex-wrap gap-2">
                  {SKIN_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => update({ skinType: t })}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                        form.skinType === t
                          ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                          : "border-gray-200 text-gray-700 hover:border-rose-300"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">皮肤敏感程度</label>
                <div className="flex flex-wrap gap-2">
                  {SENSITIVITY.map((s) => (
                    <button
                      key={s}
                      onClick={() => update({ sensitivity: s })}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                        form.sensitivity === s
                          ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                          : "border-gray-200 text-gray-700 hover:border-rose-300"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">性别（可选）</label>
                <div className="flex gap-2">
                  {["女", "男", "不透露"].map((g) => (
                    <button
                      key={g}
                      onClick={() => update({ gender: g })}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                        form.gender === g
                          ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                          : "border-gray-200 text-gray-700 hover:border-rose-300"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Concerns + preferences */}
          {form.step === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">你的皮肤关注点</h2>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">皮肤问题（可多选）</label>
                <div className="flex flex-wrap gap-2">
                  {SKIN_CONCERNS.map((c) => (
                    <button
                      key={c}
                      onClick={() => toggleConcern(c)}
                      className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                        form.skinConcerns.includes(c)
                          ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                          : "border-gray-200 text-gray-700 hover:border-rose-300"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                  <button
                    onClick={() => toggleConcern("其他")}
                    className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                      form.skinConcerns.includes("其他")
                        ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                        : "border-gray-200 text-gray-700 hover:border-rose-300"
                    }`}
                  >
                    其他
                  </button>
                </div>
                {form.skinConcerns.includes("其他") && (
                  <input
                    type="text"
                    value={form.otherConcern}
                    onChange={(e) => update({ otherConcern: e.target.value })}
                    placeholder="请描述你的皮肤问题..."
                    className="mt-3 w-full border border-rose-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">年龄段</label>
                <select
                  value={form.ageRange}
                  onChange={(e) => update({ ageRange: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                >
                  <option value="">请选择</option>
                  {AGE_RANGES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">预算范围（每件单品）</label>
                <div className="flex justify-between items-center mb-4 px-1">
                  <span className="text-base font-semibold text-rose-500">¥{form.budgetMin}</span>
                  <span className="text-xs text-gray-400">—</span>
                  <span className="text-base font-semibold text-fuchsia-500">
                    {form.budgetMax >= MAX_BUDGET ? `¥${MAX_BUDGET}+` : `¥${form.budgetMax}`}
                  </span>
                </div>
                <div className="range-dual relative h-2 mx-2">
                  <div className="absolute inset-0 rounded-full bg-gray-100" />
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-rose-400 to-fuchsia-500"
                    style={{
                      left: `${(form.budgetMin / MAX_BUDGET) * 100}%`,
                      right: `${((MAX_BUDGET - form.budgetMax) / MAX_BUDGET) * 100}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={MAX_BUDGET}
                    step={BUDGET_STEP}
                    value={form.budgetMin}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v < form.budgetMax - BUDGET_STEP) update({ budgetMin: v });
                    }}
                    style={{ zIndex: form.budgetMin >= MAX_BUDGET - BUDGET_STEP ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={MAX_BUDGET}
                    step={BUDGET_STEP}
                    value={form.budgetMax}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v > form.budgetMin + BUDGET_STEP) update({ budgetMax: v });
                    }}
                    style={{ zIndex: form.budgetMin >= MAX_BUDGET - BUDGET_STEP ? 3 : 5 }}
                  />
                </div>
                <div className="flex justify-between mt-3 px-1">
                  <span className="text-xs text-gray-400">¥0</span>
                  <span className="text-xs text-gray-400">¥500</span>
                  <span className="text-xs text-gray-400">¥1000</span>
                  <span className="text-xs text-gray-400">¥1500</span>
                  <span className="text-xs text-gray-400">¥2000+</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">产品质地偏好</label>
                  <select
                    value={form.texture}
                    onChange={(e) => update({ texture: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  >
                    <option value="">请选择</option>
                    {TEXTURES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">香味偏好</label>
                  <select
                    value={form.fragrance}
                    onChange={(e) => update({ fragrance: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  >
                    <option value="">请选择</option>
                    {FRAGRANCES.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">需要避免的成分（可选）</label>
                <input
                  type="text"
                  value={form.avoidIngredients}
                  onChange={(e) => update({ avoidIngredients: e.target.value })}
                  placeholder="例如：酒精、香料、矿油..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">现在使用的产品（可选，用于检测成分冲突）</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={form.newProduct}
                    onChange={(e) => update({ newProduct: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && addProduct()}
                    placeholder="输入产品名称后按 Enter 或点击 +"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                  <button onClick={addProduct} className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center hover:bg-rose-200 transition-colors">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.currentProducts.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 bg-rose-50 border border-rose-200 text-rose-700 text-xs px-3 py-1 rounded-full">
                      {p}
                      <button onClick={() => removeProduct(p)} className="hover:text-rose-900"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Photo + Location */}
          {form.step === 3 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">照片与位置（可选）</h2>

              {/* Image upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">上传面部照片（提升分析精准度）</label>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-rose-200 rounded-2xl p-8 text-center cursor-pointer hover:border-rose-400 hover:bg-rose-50/50 transition-all"
                >
                  {form.imagePreview ? (
                    <div className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.imagePreview} alt="preview" className="h-40 w-40 object-cover rounded-xl mx-auto" />
                      <button
                        onClick={(e) => { e.stopPropagation(); update({ image: null, imagePreview: null }); }}
                        className="absolute -top-2 -right-2 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center hover:bg-rose-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-rose-300 mx-auto mb-3" />
                      <p className="text-sm text-gray-500">拖拽图片到此处，或点击上传</p>
                      <p className="text-xs text-gray-400 mt-1">支持 JPG, PNG, WebP · 最大 10MB</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleImage(e.target.files[0])}
                />
              </div>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">所在城市（用于天气适配推荐）</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => update({ city: e.target.value, useGPS: false })}
                    placeholder="例如：北京、Shanghai、London..."
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                  <button
                    onClick={detectGPS}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                      form.useGPS
                        ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                        : "border-gray-200 text-gray-700 hover:border-rose-300"
                    }`}
                  >
                    <MapPin className="w-4 h-4" />
                    {form.useGPS ? "已定位" : "自动定位"}
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-rose-50 rounded-2xl p-4 text-sm text-gray-600 space-y-1">
                <p><span className="font-medium">肤质：</span>{form.skinType} · {form.sensitivity}</p>
                <p><span className="font-medium">关注点：</span>{form.skinConcerns.join("、") || "—"}</p>
                <p><span className="font-medium">预算：</span>¥{form.budgetMin} — {form.budgetMax >= MAX_BUDGET ? `¥${MAX_BUDGET}+` : `¥${form.budgetMax}`}</p>
                {form.currentProducts.length > 0 && (
                  <p><span className="font-medium">当前产品：</span>{form.currentProducts.join("、")}</p>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={() => update({ step: form.step - 1 })}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors ${form.step === 1 ? "invisible" : ""}`}
            >
              <ChevronLeft className="w-4 h-4" /> 上一步
            </button>

            {form.step < 3 ? (
              <button
                onClick={() => update({ step: form.step + 1 })}
                disabled={!canNext()}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                下一步 <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex items-center gap-2 px-8 py-2.5 bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white rounded-xl font-semibold hover:shadow-lg disabled:opacity-50 transition-all"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> AI 分析中...</>
                ) : (
                  <><Camera className="w-4 h-4" /> 开始分析</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
