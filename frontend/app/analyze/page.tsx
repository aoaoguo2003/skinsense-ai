"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Camera, X, MapPin, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";
import { analyzeSkin } from "@/lib/api";
import { Questionnaire } from "@/lib/types";

const BUDGET_VALUES = [
  ...Array.from({ length: 41 }, (_, i) => i * 50),       // 0, 50, 100, ..., 2000
  ...Array.from({ length: 8 }, (_, i) => 3000 + i * 1000), // 3000, 4000, ..., 10000
];
const TEXTURES = ["清爽水感", "轻薄乳液", "普通乳霜", "厚重滋润", "无偏好"];
const FRAGRANCES = ["偏好有香味", "偏好无香", "无所谓"];
interface FormState {
  step: number;
  budgetMin: number;
  budgetMax: number;
  texture: string;
  avoidIngredients: string;
  fragrance: string;
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
  const [scanInstruction, setScanInstruction] = useState("请正对镜头");
  const [completedScanPhases, setCompletedScanPhases] = useState(0);
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
      budgetMin: 0,
      budgetMax: 500,
      texture: "",
      avoidIngredients: "",
      fragrance: "",
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
    setScanInstruction("请正对镜头");
    setCompletedScanPhases(0);

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

      const scanPhases = [
        { label: "请正对镜头", minMs: 2200, maxMs: 5200 },
        { label: "请缓慢向左转头", minMs: 2800, maxMs: 6200 },
        { label: "请缓慢向右转头", minMs: 2800, maxMs: 6200 },
      ];
      const clearFrameScore = 0.42;
      const best: ScanCapture[] = [];

      for (let phaseIndex = 0; phaseIndex < scanPhases.length; phaseIndex += 1) {
        const phase = scanPhases[phaseIndex];
        const phaseCaptures: ScanCapture[] = [];
        const startedAt = Date.now();
        setScanInstruction(phase.label);

        while (Date.now() - startedAt < phase.maxMs) {
          await new Promise((resolve) => setTimeout(resolve, 360));
          const capture = await captureFrame();
          if (capture) phaseCaptures.push(capture);

          const elapsed = Date.now() - startedAt;
          const phaseBase = (phaseIndex / scanPhases.length) * 100;
          const phaseProgress = Math.min(elapsed / phase.maxMs, 1) * (100 / scanPhases.length);
          setScanProgress(Math.min(99, Math.round(phaseBase + phaseProgress)));

          const hasClearFrame =
            elapsed >= phase.minMs &&
            phaseCaptures.some((item) => item.score >= clearFrameScore);
          if (hasClearFrame) break;
        }

        const phaseBest = phaseCaptures.sort((a, b) => b.score - a.score)[0];
        if (!phaseBest || phaseBest.score < clearFrameScore) {
          phaseCaptures.forEach((capture) => URL.revokeObjectURL(capture.preview));
          throw new Error(`${phase.label}时画面不够清晰，请调整光线并保持动作稳定后重试`);
        }

        best.push(phaseBest);
        setCompletedScanPhases(phaseIndex + 1);
        phaseCaptures
          .filter((capture) => capture !== phaseBest)
          .forEach((capture) => URL.revokeObjectURL(capture.preview));
      }

      setScanInstruction("采集完成");
      setScanProgress(100);
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
      setCompletedScanPhases(0);
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
      () => {
        update({ useGPS: false });
        setGpsLocating(false);
      }
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
    return true;
  };

  const handleSubmit = async () => {
    setProgress(0);
    setLoading(true);
    setError("");
    try {
      const questionnaire: Questionnaire = {
        skin_concerns: ["由AI根据面部采集自动识别"],
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
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                form.step >= s ? "bg-gradient-to-br from-rose-500 to-fuchsia-500 text-white" : "bg-white text-gray-400 border"
              }`}>
                {s}
              </div>
              {s < 2 && <div className={`flex-1 h-1 w-16 rounded ${form.step > s ? "bg-rose-300" : "bg-gray-200"}`} />}
            </div>
          ))}
          <span className="ml-auto text-sm text-gray-500">
            {form.step === 1 ? "面部采集" : "偏好"}
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
                    {scanning && (
                      <>
                        <div className="absolute inset-0 bg-[linear-gradient(rgba(56,189,248,0.10)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.10)_1px,transparent_1px)] bg-[size:34px_34px]" />
                        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/60 to-transparent" />
                        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/70 to-transparent" />
                        <div className="absolute left-8 top-8 h-16 w-16 border-l-2 border-t-2 border-sky-300" />
                        <div className="absolute right-8 top-8 h-16 w-16 border-r-2 border-t-2 border-sky-300" />
                        <div className="absolute left-8 bottom-8 h-16 w-16 border-l-2 border-b-2 border-sky-300" />
                        <div className="absolute right-8 bottom-8 h-16 w-16 border-r-2 border-b-2 border-sky-300" />
                        <div className="absolute left-1/2 top-1/2 h-[58vh] w-[38vh] -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-100/60 shadow-[0_0_70px_rgba(56,189,248,0.45)]" />
                        <div
                          className="absolute left-1/2 h-[2px] w-[42vh] -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-[0_0_20px_rgba(34,211,238,0.95)] transition-all duration-300"
                          style={{ top: `${18 + scanProgress * 0.64}%` }}
                        />
                        <div className="absolute left-1/2 top-8 -translate-x-1/2 rounded-full border border-sky-200/30 bg-sky-950/35 px-5 py-2 text-xs font-medium tracking-[0.25em] text-sky-100 backdrop-blur">
                          SKINSCAN ACTIVE
                        </div>
                        <div className="absolute left-1/2 top-[18%] -translate-x-1/2 text-center">
                          <p className="text-2xl font-semibold text-white drop-shadow">{scanInstruction}</p>
                          <p className="mt-2 text-sm text-white/70">保持面部在轮廓范围内</p>
                        </div>
                      </>
                    )}
                    {!scanning && (
                      <div className="text-center px-6">
                        <Camera className="w-9 h-9 text-rose-300 mx-auto mb-3" />
                        <p className="text-sm text-white font-medium">准备好后开始扫描</p>
                      </div>
                    )}
                    {scanning && (
                      <div className="absolute inset-x-6 bottom-8">
                        <div className="grid grid-cols-3 gap-3">
                          {["正脸", "左脸", "右脸"].map((label, index) => {
                            const done = completedScanPhases > index;
                            const active = completedScanPhases === index;
                            return (
                              <div
                                key={label}
                                className={`rounded-xl border px-3 py-2 text-center text-xs font-semibold backdrop-blur ${
                                  done
                                    ? "border-cyan-200/50 bg-cyan-300/20 text-cyan-100"
                                    : active
                                      ? "border-sky-300/50 bg-sky-500/20 text-sky-100"
                                      : "border-white/15 bg-black/20 text-white/45"
                                }`}
                              >
                                {label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} className="hidden" />

                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={startFaceScan}
                      disabled={loading || scanning}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white text-sm font-semibold hover:shadow-lg disabled:opacity-50 transition-all"
                    >
                      {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      {scanning ? "扫描中..." : "开始扫描"}
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
                        重新扫描
                      </button>
                    )}
                  </div>

                  {form.scanPreviews.length > 0 && (
                    <div className="mt-4 flex justify-center">
                      <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700">
                        面部扫描已完成
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Step 2: Preferences */}
          {form.step === 2 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">产品偏好</h2>

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
                <label className="block text-sm font-medium text-gray-700 mb-3">所在城市</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gpsLocating ? "定位中..." : form.city}
                    onChange={(e) => update({ city: e.target.value, useGPS: false })}
                    placeholder="例如：北京、Shanghai、London..."
                    readOnly={gpsLocating}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-300"
                  />
                  <button
                    type="button"
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

            {form.step < 2 ? (
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
