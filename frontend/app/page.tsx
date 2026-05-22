"use client";
import Link from "next/link";
import { Sparkles, Camera, FlaskConical, CloudSun, ArrowRight } from "lucide-react";

const features = [
  {
    icon: <Camera className="w-6 h-6" />,
    title: "智能肌肤分析",
    desc: "上传自拍或填写问卷，精准识别你的肤质、肤色和皮肤问题",
  },
  {
    icon: <Sparkles className="w-6 h-6" />,
    title: "个性化产品推荐",
    desc: "基于你的肤质和预算，推荐真实市售化妆品与护肤品",
  },
  {
    icon: <FlaskConical className="w-6 h-6" />,
    title: "成分深度解析",
    desc: "了解每款产品的关键成分，检测现有产品的成分互斥与协同效果",
  },
  {
    icon: <CloudSun className="w-6 h-6" />,
    title: "天气适配推荐",
    desc: "结合你所在地的实时天气、湿度和紫外线强度，给出最适合当下环境的建议",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-rose-50 via-pink-50 to-fuchsia-50">
      <section className="flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-white/70 backdrop-blur border border-rose-200 rounded-full px-4 py-1.5 text-sm text-rose-600 font-medium mb-8 shadow-sm">
          <Sparkles className="w-4 h-4" />
          你的专业美容顾问
        </div>

        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight max-w-3xl">
          了解你的肌肤，
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-fuchsia-500">
            找到专属配方
          </span>
        </h1>

        <p className="mt-6 text-lg text-gray-600 max-w-xl leading-relaxed">
          上传一张自拍，填写简单问卷，为你分析肤质、检测成分冲突，
          并结合当地天气推荐最适合你的护肤与彩妆产品。
        </p>

        <Link
          href="/analyze"
          className="mt-10 inline-flex items-center gap-2 bg-gradient-to-r from-rose-500 to-fuchsia-500 text-white font-semibold px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
        >
          开始免费检测
          <ArrowRight className="w-5 h-5" />
        </Link>

        <p className="mt-4 text-sm text-gray-400">无需注册 · 结果即时生成 · 完全免费</p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((f, i) => (
          <div
            key={i}
            className="bg-white/70 backdrop-blur border border-white rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-12 h-12 bg-gradient-to-br from-rose-100 to-fuchsia-100 rounded-xl flex items-center justify-center text-rose-500 mb-4">
              {f.icon}
            </div>
            <h3 className="font-semibold text-gray-900 text-lg mb-2">{f.title}</h3>
            <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
