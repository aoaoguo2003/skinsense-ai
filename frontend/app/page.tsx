"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Camera, FlaskConical, CloudSun, ArrowRight } from "lucide-react";

const features = [
  {
    icon: <Camera className="w-6 h-6" />,
    title: "Smart Skin Analysis",
    desc: "Scan your face from the front and sides; AI accurately identifies your skin type, tone, and concerns.",
  },
  {
    icon: <Sparkles className="w-6 h-6" />,
    title: "Personalized Recommendations",
    desc: "Based on your skin type and budget, we recommend real, market-available skincare and makeup products.",
  },
  {
    icon: <FlaskConical className="w-6 h-6" />,
    title: "In-Depth Ingredient Analysis",
    desc: "Understand the key ingredients in each product, detect ingredient conflicts, and discover synergistic combinations.",
  },
  {
    icon: <CloudSun className="w-6 h-6" />,
    title: "Weather-Adapted Advice",
    desc: "Combining real-time local weather, humidity, and UV index to give advice best suited to your current environment.",
  },
];

export default function HomePage() {
  const router = useRouter();

  const handleStart = () => {
    const authed =
      typeof window !== "undefined" && localStorage.getItem("skinsense_auth") === "1";
    router.push(authed ? "/analyze" : "/login");
  };

  return (
    <main className="min-h-screen bg-stone-100">
      {/* Hero */}
      <section className="relative min-h-[92vh] md:min-h-screen flex flex-col items-center justify-center px-6 text-center overflow-hidden bg-stone-800">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat md:hidden"
          style={{ backgroundImage: "url('/hero-mobile.jpg')" }}
        />
        <div
          className="absolute inset-0 hidden bg-cover bg-center bg-no-repeat md:block"
          style={{ backgroundImage: "url('/hero.jpg')" }}
        />
        {/* Dark scrim over image */}
        <div className="absolute inset-0 bg-black/45 md:bg-black/40" />

        {/* Top bar with login entry */}
        <div className="absolute top-0 inset-x-0 z-20 flex justify-end p-5 sm:p-6">
          <Link
            href="/login"
            className="text-sm font-medium text-white/90 hover:text-white border border-white/30 hover:border-white/60 rounded-full px-4 py-1.5 backdrop-blur-sm transition-colors"
          >
            Log in
          </Link>
        </div>

        <div className="relative z-10 flex flex-col items-center max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 text-sm text-white/90 font-medium mb-8">
            <Sparkles className="w-4 h-4" />
            Your professional beauty advisor
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white leading-tight">
            Understand your skin,
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-300 to-fuchsia-300">
              find your formula
            </span>
          </h1>

          <p className="mt-6 text-base md:text-lg text-white/70 max-w-xl leading-relaxed">
            Scan your face, tell us your product preferences, and instantly get a skin analysis, ingredient-conflict detection, and personalized skincare and makeup recommendations.
          </p>

          <button
            onClick={handleStart}
            className="mt-10 inline-flex items-center gap-2 bg-white text-gray-900 font-semibold px-8 py-4 rounded-2xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
          >
            Start Analysis
            <ArrowRight className="w-5 h-5" />
          </button>
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
