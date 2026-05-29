"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Camera, MapPin, ChevronRight, ChevronLeft, Loader2, CheckCircle2 } from "lucide-react";
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
  balance: number;
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
  const [scanCompleted, setScanCompleted] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanInstruction, setScanInstruction] = useState("请正对镜头");
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

  const advanceToPreferences = useCallback((captures: ScanCapture[]) => {
    const scanImages = captures.map((capture) => capture.file);
    const scanPreviews = captures.map((capture) => capture.preview);

    setForm((f) => {
      const next = { ...f, step: 2, scanImages, scanPreviews };
      try {
        const { scanImages: _scanImages, scanPreviews: _scanPreviews, ...saveable } = next;
        void _scanImages;
        void _scanPreviews;
        sessionStorage.setItem("skinsense_form", JSON.stringify(saveable));
      } catch {}
      return next;
    });
    setScanCompleted(true);
    setScanning(false);
  }, []);

  const scoreFrame = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const { data } = ctx.getImageData(0, 0, width, height);
    let brightness = 0;
    let leftBrightness = 0;
    let rightBrightness = 0;
    let contrast = 0;
    let previous = 0;
    let samples = 0;

    for (let y = 0; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        const i = (y * width + x) * 4;
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        brightness += gray;
        if (x < width / 2) leftBrightness += gray;
        else rightBrightness += gray;
        contrast += Math.abs(gray - previous);
        previous = gray;
        samples += 1;
      }
    }

    const avgBrightness = brightness / samples;
    const brightnessScore = 1 - Math.min(Math.abs(avgBrightness - 145) / 145, 1);
    const contrastScore = Math.min(contrast / samples / 28, 1);
    const balance = (rightBrightness - leftBrightness) / Math.max(rightBrightness + leftBrightness, 1);

    return {
      score: brightnessScore * 0.65 + contrastScore * 0.35,
      balance,
    };
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
    const metrics = scoreFrame(ctx, width, height);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const file = new File([blob], `face-scan-${Date.now()}.jpg`, { type: "image/jpeg" });
        resolve({ file, preview: URL.createObjectURL(blob), ...metrics });
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

  const isValidScanPhase = (
    capture: ScanCapture,
    phaseIndex: number,
    acceptedCaptures: ScanCapture[],
    clearFrameScore: number,
  ) => {
    if (capture.score < clearFrameScore) return false;
    if (phaseIndex === 0) return true;

    const frontCapture = acceptedCaptures[0];
    if (!frontCapture) return false;

    const sideDelta = Math.abs(capture.balance - frontCapture.balance);
    if (sideDelta < 0.018) return false;

    if (phaseIndex === 2) {
      const leftCapture = acceptedCaptures[1];
      if (!leftCapture) return false;
      return Math.abs(capture.balance - leftCapture.balance) >= 0.025;
    }

    return true;
  };

  const startFaceScan = async () => {
    if (loading || scanning) return;
    let scanSucceeded = false;
    setError("");
    setScanCompleted(false);
    setScanProgress(0);
    setScanInstruction("请正对镜头");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
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
        { label: "请正对镜头", failLabel: "正脸", minMs: 2200, maxMs: 5200 },
        { label: "请缓慢向左转头", failLabel: "左脸", minMs: 3200, maxMs: 7600 },
        { label: "请缓慢向右转头", failLabel: "右脸", minMs: 3200, maxMs: 7600 },
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
            phaseCaptures.some((item) => isValidScanPhase(item, phaseIndex, best, clearFrameScore));
          if (hasClearFrame) break;
        }

        const phaseBest = phaseCaptures
          .filter((capture) => isValidScanPhase(capture, phaseIndex, best, clearFrameScore))
          .sort((a, b) => b.score - a.score)[0];
        if (!phaseBest) {
          phaseCaptures.forEach((capture) => URL.revokeObjectURL(capture.preview));
          throw new Error(`${phase.failLabel}没有扫描清楚，请转头幅度稍大一些并保持稳定后重试`);
        }

        best.push(phaseBest);
        phaseCaptures
          .filter((capture) => capture !== phaseBest)
          .forEach((capture) => URL.revokeObjectURL(capture.preview));
      }

      setScanInstruction("采集完成 ✓");
      setScanProgress(100);
      form.scanPreviews.forEach((preview) => URL.revokeObjectURL(preview));
      advanceToPreferences(best);
      scanSucceeded = true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "无法打开摄像头，请检查浏览器权限后重试");
    } finally {
      stopCamera();
      if (!scanSucceeded) {
        setScanCompleted(false);
        setScanProgress(0);
      }
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
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    if (nav?.type === "reload") {
      router.replace("/");
    }
  }, [router]);

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
  const scanComplete = scanCompleted || form.scanImages.length >= 3;

  const canNext = () => {
    if (form.step === 1) return scanComplete;
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
    <main className="relative min-h-screen overflow-hidden bg-stone-200 px-4 py-12">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/report-bg.jpg')" }}
      />
      <div className="absolute inset-0 bg-white/55" />

      {/* ── Full-screen scan overlay ── outside backdrop-blur card to avoid containing-block trap */}
      <video
        ref={videoRef}
        className={`fixed inset-0 z-50 h-full w-full object-cover scale-x-[-1] ${scanning ? "block" : "hidden"}`}
        muted
        playsInline
      />
      {scanning && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black/15 mix-blend-multiply" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_32%,rgba(180,130,0,0.14)_58%,rgba(0,0,0,0.72)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(251,191,36,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(251,191,36,0.07)_1px,transparent_1px)] bg-[size:34px_34px]" />
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/85 to-transparent" />
          <div className="absolute left-8 top-8 h-16 w-16 border-l-2 border-t-2 border-amber-400" />
          <div className="absolute right-8 top-8 h-16 w-16 border-r-2 border-t-2 border-amber-400" />
          <div className="absolute left-8 bottom-8 h-16 w-16 border-l-2 border-b-2 border-amber-400" />
          <div className="absolute right-8 bottom-8 h-16 w-16 border-r-2 border-b-2 border-amber-400" />
          <div className="absolute left-1/2 top-1/2 h-[58vh] w-[38vh] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/30 shadow-[0_0_44px_rgba(251,191,36,0.22)]" />
          <div className="absolute left-1/2 top-1/2 h-[64vh] w-[44vh] -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-400/10" />
          <div className="animate-scan-sweep absolute left-1/2 h-[2px] w-[42vh] -translate-x-1/2 bg-gradient-to-r from-transparent via-amber-300 to-transparent shadow-[0_0_28px_rgba(251,191,36,0.95)]" />
          <div className="absolute left-1/2 top-8 -translate-x-1/2 rounded-full border border-amber-400/30 bg-black/40 px-5 py-2 text-xs font-medium tracking-[0.25em] text-amber-200 backdrop-blur">
            SKINSCAN ACTIVE
          </div>
          <div className="absolute left-1/2 top-[18%] -translate-x-1/2 text-center">
            <p className="text-2xl font-semibold text-white drop-shadow">{scanInstruction}</p>
            <p className="mt-2 text-sm text-white/70">保持面部在轮廓范围内</p>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />

      <div className={`relative z-10 ${form.step === 2 ? "max-w-5xl" : "max-w-2xl"} mx-auto transition-all duration-500`}>

        <div className="rounded-3xl p-6 md:p-8">

          {/* Step 1: Face scan */}
          {form.step === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">面部采集</h2>
              <p className="text-sm text-gray-500 -mt-2">保持正对镜头，使用自然、稳定的光线。</p>

              <div>
                  <div className="relative overflow-hidden rounded-2xl aspect-video bg-neutral-950 flex items-center justify-center">
                    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.1),transparent_40%),linear-gradient(135deg,#0a0a0a,#1a1200_52%,#0d0d0d)]">
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(251,191,36,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(251,191,36,0.07)_1px,transparent_1px)] bg-[size:32px_32px]" />
                      <div className="absolute left-1/2 top-1/2 h-[70%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/5 shadow-[0_0_38px_rgba(251,191,36,0.15)]" />
                      <div className="absolute left-8 top-8 h-12 w-12 border-l-2 border-t-2 border-amber-400/70" />
                      <div className="absolute right-8 top-8 h-12 w-12 border-r-2 border-t-2 border-amber-400/70" />
                      <div className="absolute left-8 bottom-8 h-12 w-12 border-l-2 border-b-2 border-amber-400/70" />
                      <div className="absolute right-8 bottom-8 h-12 w-12 border-r-2 border-b-2 border-amber-400/70" />
                      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-neutral-950 to-transparent" />
                    </div>
                    <div className="relative z-10 text-center px-6">
                      {scanComplete ? (
                        <>
                          <CheckCircle2 className="w-10 h-10 text-amber-300 mx-auto mb-3" />
                          <p className="text-base font-semibold text-white">扫描完成</p>
                          <p className="mt-2 text-xs text-amber-200/75">已完成正脸、左脸、右脸采集</p>
                        </>
                      ) : (
                        <>
                          <Camera className="w-9 h-9 text-amber-300 mx-auto mb-3" />
                          <p className="text-sm text-white font-medium">准备好后开始扫描</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={startFaceScan}
                      disabled={loading || scanning || scanComplete}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-gray-900 border border-gray-200 text-sm font-semibold hover:bg-stone-50 hover:shadow-md disabled:opacity-50 transition-all"
                    >
                      {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : scanComplete ? <CheckCircle2 className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                      {scanning ? "扫描中..." : scanComplete ? "扫描完成" : "开始扫描"}
                    </button>
                  </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">⚠️</span>
                  <div>
                    <p>{error}</p>
                    <p className="mt-1 text-xs text-red-500">点击「开始扫描」可重新采集。</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Preferences */}
          {form.step === 2 && (
            <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-stretch">
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">产品偏好</h2>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">预算范围（每件单品）</label>
                  <div className="flex justify-between items-center mb-4 px-1">
                    <span className="text-base font-semibold text-stone-500">¥{form.budgetMin}</span>
                    <span className="text-xs text-stone-400">—</span>
                    <span className="text-base font-semibold text-stone-500">
                      {form.budgetMax >= 10000 ? "¥10000+" : `¥${form.budgetMax}`}
                    </span>
                  </div>
                  <div className="range-dual relative h-2 mx-2">
                    <div className="absolute inset-0 rounded-full bg-gray-100" />
                    <div
                      className="absolute h-full rounded-full bg-stone-700"
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
                          className="absolute text-xs text-stone-500 -translate-x-1/2"
                          style={{ left: `${pct}%` }}
                        >
                          {value === 10000 ? "¥10000+" : `¥${value}`}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">产品质地偏好</label>
                    <select
                      value={form.texture}
                      onChange={(e) => update({ texture: e.target.value })}
                      className="w-full border border-stone-400 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
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
                      className="w-full border border-stone-400 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
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
                    className="w-full border border-stone-400 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-3">所在城市</label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={gpsLocating ? "定位中..." : form.city}
                      onChange={(e) => update({ city: e.target.value, useGPS: false })}
                      placeholder="例如：北京、Shanghai、London..."
                      readOnly={gpsLocating}
                      className="flex-1 border border-stone-400 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-stone-500"
                    />
                    <button
                      type="button"
                      onClick={detectGPS}
                      disabled={gpsLocating}
                      className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border text-sm font-medium transition-all disabled:opacity-60 ${
                        form.useGPS
                          ? "bg-white text-gray-900 border border-gray-900"
                          : "border-stone-400 text-gray-700 hover:border-stone-600"
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

              <div className="relative hidden min-h-[520px] overflow-hidden rounded-2xl border border-stone-200 bg-stone-100 lg:block">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: "url('/preference-still-life.jpg')" }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/45 via-stone-900/5 to-white/10" />
                <div className="absolute inset-x-6 bottom-6 rounded-2xl border border-white/30 bg-white/65 p-5 shadow-lg backdrop-blur-md">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Product Profile</p>
                  <p className="mt-2 text-sm leading-relaxed text-stone-700">
                    预算、质地、香味和避开成分会参与推荐排序，让结果更贴近你的真实购买偏好。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8 pt-6">
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
                className="flex items-center gap-2 px-6 py-2.5 bg-white text-gray-900 border border-gray-200 rounded-xl font-medium hover:bg-stone-50 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                下一步 <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex flex-col items-end gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex items-center gap-2 px-8 py-2.5 bg-white text-gray-900 border border-gray-200 rounded-xl font-semibold hover:bg-stone-50 hover:shadow-md disabled:opacity-50 transition-all"
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
                <span className="font-medium text-stone-700">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-stone-700 rounded-full transition-all duration-500"
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
