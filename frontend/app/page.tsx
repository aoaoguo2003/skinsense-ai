"use client";
import Link from "next/link";
import { Sparkles, Camera, FlaskConical, CloudSun, ArrowRight } from "lucide-react";

const features = [
  {
    icon: <Camera className="w-6 h-6" />,
    title: "智能肌肤分析",
    desc: "用摄像头扫描正脸与侧脸，AI 精准识别你的肤质、肤色和皮肤问题",
  },
  {
    icon: <Sparkles className="w-6 h-6" />,
    title: "个性化产品推荐",
    desc: "基于你的肤质和预算，推荐真实市售化妆品与护肤品",
  },
  {
    icon: <FlaskConical className="w-6 h-6" />,
    title: "成分深度解析",
    desc: "了解每款推荐产品的关键成分，检测成分互斥冲突，发现协同增效组合",
  },
  {
    icon: <CloudSun className="w-6 h-6" />,
    title: "天气适配推荐",
    desc: "结合你所在地的实时天气、湿度和紫外线强度，给出最适合当下环境的建议",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-stone-100">
      {/* Hero */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center px-6 text-center bg-cover bg-center bg-no-repeat bg-stone-800"
        style={{ backgroundImage: "url('/hero.jpg')" }}
      >
        {/* Dark scrim over image */}
        <div className="absolute inset-0 bg-black/40" />

        <div className="relative z-10 flex flex-col items-center max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm text-white/90 font-medium mb-8">
            <Sparkles className="w-4 h-4" />
            你的专业美容顾问
          </div>

          <h1 className="text-5xl md:text-6xl font-bold text-white leading-tight">
            了解你的肌肤，
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-300 to-fuchsia-300">
              找到专属配方
            </span>
          </h1>

          <p className="mt-6 text-lg text-white/70 max-w-xl leading-relaxed">
            用摄像头扫描面部，告诉我们你的产品偏好，AI 即刻分析肤质、检测成分冲突，
            并结合当地天气推荐最适合你的护肤与彩妆产品。
          </p>

          <Link
            href="/analyze"
            className="mt-10 inline-flex items-center gap-2 bg-white text-gray-900 font-semibold px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          >
            开始检测
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>

        {/* Bottom fade into features section */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-stone-100 to-transparent" />
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-24 pt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((f, i) => (
          <div
            key={i}
            className="bg-gradient-to-br from-stone-200 to-stone-300 border border-stone-300 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-12 h-12 bg-stone-100 rounded-xl flex items-center justify-center text-stone-600 mb-4">
              {f.icon}
            </div>
            <h3 className="font-semibold text-stone-900 text-lg mb-2">{f.title}</h3>
            <p className="text-stone-500 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
