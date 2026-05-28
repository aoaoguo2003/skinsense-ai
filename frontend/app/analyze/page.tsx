"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Camera, X, MapPin, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { analyzeSkin } from "@/lib/api";
import { Questionnaire } from "@/lib/types";

const SKIN_CONCERNS = ["痘痘/粉刺", "黑头", "毛孔粗大", "细纹/皱纹", "色斑/暗沉", "红血丝", "泛红敏感", "黑眼圈", "干燥脱皮", "出油过多"];
const BUDGET_VALUES = [
  ...Array.from({ length: 41 }, (_, i) => i * 50),       // 0, 50, 100, ..., 2000
  ...Array.from({ length: 8 }, (_, i) => 3000 + i * 1000), // 3000, 4000, ..., 10000
];
const TEXTURES = ["清爽水感", "轻薄乳液", "普通乳霜", "厚重滋润", "无偏好"];
const FRAGRANCES = ["偏好有香味", "偏好无香", "无所谓"];
interface FormState {
  step: number;
  skinConcerns: string[];
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
  scanImages: File[];
  scanPreviews: string[];
}

interface ScanCapture {
  file: File;
  preview: string;
  score: number;
}

export default function AnalyzePage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [gpsLocating, setGpsLocating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const [form, setForm] = useState<FormState>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("skinsense_form");
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...parsed, scanImages: [], scanPreviews: [] };
        }
      } catch {}
    }
    return {
      step: 1,
      skinConcerns: [],
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
      scanImages: [],
      scanPreviews: [],
    };
  });

  const update = useCallback((patch: Partial<FormState>) => setForm((f) => {
    const next = { ...f, ...patch };
    try {
      const { scanImages, scanPreviews, ...saveable } = next;
      void scanImages;
      void scanPreviews;
      sessionStorage.setItem("skinsense_form", JSON.stringify(saveable));
    } catch {}
    return next;
  }), []);

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

  const scoreFrame = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const { data } = ctx.getImageData(0, 0, width, height);
    let brightness = 0;
    let contrast = 0;
    let previous = 0;

    for (let i = 0; i < data.length; i += 16) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      brightness += gray;
      contrast += Math.abs(gray - previous);
      previous = gray;
    }

    const samples = data.length / 16;
    const avgBrightness = brightness / samples;
    const brightnessScore = 1 - Math.min(Math.abs(avgBrightness - 145) / 145, 1);
    const contrastScore = Math.min(contrast / samples / 28, 1);

    return brightnessScore * 0.65 + contrastScore * 0.35;
  };

  const captureFrame = async (): Promise<ScanCapture | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const width = 640;
    const height = Math.round((video.videoHeight / video.videoWidth) * width) || 480;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    const score = scoreFrame(ctx, width, height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const file = new File([blob], `face-scan-${Date.now()}.jpg`, { type: "image/jpeg" });
        resolve({ file, preview: URL.createObjectURL(blob), score });
      }, "image/jpeg", 0.9);
    });
  };

  const stopCamera = useCallback(() => {
    setCameraStream((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
      return null;
    });
    setScanning(false);
  }, []);

  const startFaceScan = async () => {
    if (loading || scanning) return;
    setError("");
    setScanProgress(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      setCameraStream(stream);
      setScanning(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      const captures: ScanCapture[] = [];
      const totalFrames = 12;
      for (let i = 0; i < totalFrames; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, i === 0 ? 500 : 220));
        const capture = await captureFrame();
        if (capture) captures.push(capture);
        setScanProgress(Math.round(((i + 1) / totalFrames) * 100));
      }

      const best = captures
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      captures
        .filter((capture) => !best.includes(capture))
        .forEach((capture) => URL.revokeObjectURL(capture.preview));

      if (best.length === 0) {
        throw new Error("未能采集到清晰画面，请调整光线后重试");
      }

      form.scanPreviews.forEach((preview) => URL.revokeObjectURL(preview));
      update({
        scanImages: best.map((capture) => capture.file),
        scanPreviews: best.map((capture) => capture.preview),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "无法打开摄像头，请检查浏览器权限后重试");
    } finally {
      stopCamera();
      setScanProgress(0);
    }
  };

  const detectGPS = () => {
    if (!navigator.geolocation) return;
    setGpsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        update({ useGPS: true, latitude, longitude });
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { "Accept-Language": "zh-CN,zh;q=0.9" } }
          );
          const data = await res.json();
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.county ||
            data.address?.state ||
            "";
          if (city) update({ city });
        } catch {}
        setGpsLocating(false);
      },
      () => { update({ useGPS: false }); setGpsLocating(false); }
    );
  };

  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      setProgress(Math.min(90, Math.round(90 * (1 - Math.exp(-elapsed / 90)))));
    }, 300);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    return () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraStream]);

  const progressLabel =
    progress < 25 ? "正在分析肤质特征..." :
    progress < 55 ? "正在制定护肤方案..." :
    progress < 80 ? "正在筛选产品推荐..." :
    "即将完成...";

  const canNext = () => {
    if (form.step === 1) return true;
    if (form.step === 2) return form.skinConcerns.length > 0;
    return true;
  };

  const handleSubmit = async () => {
    setProgress(0);
    setLoading(true);
    setError("");
    try {
      const skinConcerns = form.skinConcerns.map((c) =>
        c === "其他" && form.otherConcern.trim() ? `其他：${form.otherConcern.trim()}` : c
      );
      const questionnaire: Questionnaire = {
        skin_concerns: skinConcerns,
        age_range: "由AI根据面部图像辅助判断，用户未手动填写",
        gender: "由AI根据面部图像辅助判断，用户未手动填写",
        budget: `¥${form.budgetMin}-${form.budgetMax >= 10000 ? "10000以上" : form.budgetMax}（每件）`,
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
        images: form.scanImages,
      });

      setProgress(100);
      sessionStorage.setItem("skinsense_result", JSON.stringify(result));
      sessionStorage.removeItem("skinsense_form");
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
            {form.step === 1 ? "面部采集" : form.step === 2 ? "皮肤关注" : "位置"}
          </span>
        </div>

        <div className="bg-white/80 backdrop-blur rounded-3xl shadow-lg p-8">

          {/* Step 1: Face scan */}
          {form.step === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">面部采集</h2>
              <p className="text-sm text-gray-500 -mt-2">保持正对镜头，使用自然、稳定的光线。</p>

              <div>
                <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
                  <div className={`relative overflow-hidden bg-gray-950 flex items-center justify-center transition-all ${
                    scanning
                      ? "fixed inset-0 z-50 rounded-none aspect-auto"
                      : "rounded-xl aspect-video"
                  }`}>
                    <video
                      ref={videoRef}
                      className={`h-full w-full object-cover scale-x-[-1] ${scanning ? "block" : "hidden"}`}
                      muted
                      playsInline
                    />
                    {!scanning && (
                      <div className="text-center px-6">
                        <Camera className="w-9 h-9 text-rose-300 mx-auto mb-3" />
                        <p className="text-sm text-white font-medium">准备好后开始采集</p>
                      </div>
                    )}
                    {scanning && (
                      <div className="absolute inset-x-6 bottom-8">
                        <div className="flex justify-between text-sm text-white mb-2">
                          <span>采集中，请保持正对镜头</span>
                          <span>{scanProgress}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-rose-300 to-fuchsia-300 transition-all"
                            style={{ width: `${scanProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} className="hidden" />

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startFaceScan}
                      disabled={loading || scanning}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white text-sm font-semibold hover:shadow-lg disabled:opacity-50 transition-all"
                    >
                      {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      {scanning ? "采集中..." : "开始采集"}
                    </button>
                    {form.scanPreviews.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          form.scanPreviews.forEach((preview) => URL.revokeObjectURL(preview));
                          update({ scanImages: [], scanPreviews: [] });
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-sm font-medium hover:border-rose-300"
                      >
                        <X className="w-4 h-4" />
                        重新采集
                      </button>
                    )}
                  </div>

                  {form.scanPreviews.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium text-gray-500 mb-2">已完成采集</p>
                      <div className="grid grid-cols-3 gap-2">
                        {form.scanPreviews.map((preview, i) => (
                          <div key={preview} className="relative aspect-square overflow-hidden rounded-xl bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={preview} alt={`scan frame ${i + 1}`} className="h-full w-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                <label className="block text-sm font-medium text-gray-700 mb-3">预算范围（每件单品）</label>
                <div className="flex justify-between items-center mb-4 px-1">
                  <span className="text-base font-semibold text-rose-500">¥{form.budgetMin}</span>
                  <span className="text-xs text-gray-400">—</span>
                  <span className="text-base font-semibold text-fuchsia-500">
                    {form.budgetMax >= 10000 ? "¥10000+" : `¥${form.budgetMax}`}
                  </span>
                </div>
                <div className="range-dual relative h-2 mx-2">
                  <div className="absolute inset-0 rounded-full bg-gray-100" />
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-rose-400 to-fuchsia-500"
                    style={{
                      left: `${(BUDGET_VALUES.indexOf(form.budgetMin) / (BUDGET_VALUES.length - 1)) * 100}%`,
                      right: `${((BUDGET_VALUES.length - 1 - BUDGET_VALUES.indexOf(form.budgetMax)) / (BUDGET_VALUES.length - 1)) * 100}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={BUDGET_VALUES.length - 1}
                    step={1}
                    value={BUDGET_VALUES.indexOf(form.budgetMin)}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      if (i < BUDGET_VALUES.indexOf(form.budgetMax) - 1) update({ budgetMin: BUDGET_VALUES[i] });
                    }}
                    style={{ zIndex: BUDGET_VALUES.indexOf(form.budgetMin) >= BUDGET_VALUES.length - 2 ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={BUDGET_VALUES.length - 1}
                    step={1}
                    value={BUDGET_VALUES.indexOf(form.budgetMax)}
                    onChange={(e) => {
                      const i = Number(e.target.value);
                      if (i > BUDGET_VALUES.indexOf(form.budgetMin) + 1) update({ budgetMax: BUDGET_VALUES[i] });
                    }}
                    style={{ zIndex: BUDGET_VALUES.indexOf(form.budgetMin) >= BUDGET_VALUES.length - 2 ? 3 : 5 }}
                  />
                </div>
                <div className="relative mt-3 px-1 h-5">
                  {([0, 1000, 2000, 10000] as const).map((value) => {
                    const idx = BUDGET_VALUES.indexOf(value);
                    const pct = (idx / (BUDGET_VALUES.length - 1)) * 100;
                    return (
                      <span
                        key={value}
                        className="absolute text-xs text-gray-400 -translate-x-1/2"
                        style={{ left: `${pct}%` }}
                      >
                        {value === 10000 ? "¥10000+" : `¥${value}`}
                      </span>
                    );
                  })}
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
                    placeholder="输入产品名称后按 Enter 添加"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
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

          {/* Step 3: Location */}
          {form.step === 3 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">位置</h2>

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">所在城市（用于天气适配推荐）</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gpsLocating ? "定位中..." : form.city}
                    onChange={(e) => update({ city: e.target.value, useGPS: false })}
                    placeholder="例如：北京、Shanghai、London..."
                    readOnly={gpsLocating}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-gray-50"
                  />
                  <button
                    onClick={detectGPS}
                    disabled={gpsLocating}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium transition-all disabled:opacity-60 ${
                      form.useGPS
                        ? "bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white border-transparent"
                        : "border-gray-200 text-gray-700 hover:border-rose-300"
                    }`}
                  >
                    <MapPin className="w-4 h-4" />
                    {gpsLocating ? "定位中..." : form.useGPS ? "已定位" : "自动定位"}
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-rose-50 rounded-2xl p-4 text-sm text-gray-600 space-y-1">
                <p><span className="font-medium">关注点：</span>{form.skinConcerns.join("、") || "—"}</p>
                <p><span className="font-medium">预算：</span>¥{form.budgetMin} — {form.budgetMax >= 10000 ? "¥10000+" : `¥${form.budgetMax}`}</p>
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
              <div className="flex flex-col items-end gap-3">
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
                {!loading && (
                  <p className="text-xs text-gray-400">约需 2–3 分钟</p>
                )}
              </div>
            )}
          </div>

          {/* Progress bar */}
          {loading && (
            <div className="mt-5">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>{progressLabel}</span>
                <span className="font-medium text-rose-500">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-400 to-fuchsia-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
