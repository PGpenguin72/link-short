import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4">
      {/* Stars */}
      <div className="pointer-events-none absolute inset-0">
        {STARS.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white animate-twinkle"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              animationDelay: `${s.delay}s`,
              opacity: s.opacity,
            }}
          />
        ))}
      </div>

      {/* Shooting star */}
      <div className="pointer-events-none absolute top-1/4 left-0 w-full">
        <div className="h-px w-24 bg-gradient-to-r from-transparent via-white to-transparent animate-shoot" />
      </div>

      <div className="relative z-10 text-center max-w-md">
        {/* Floating astronaut */}
        <div className="animate-float mb-2 inline-block">
          <Astronaut />
        </div>

        <h1 className="text-7xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-pulse-slow">
          404
        </h1>
        <h2 className="mt-2 text-xl font-bold text-white">這個連結迷失在宇宙中了</h2>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          你要找的短網址不存在、已被刪除，或已被停用。<br />
          太空人正在努力尋找，但似乎飄得有點遠……
        </p>

        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium backdrop-blur transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          返回首頁
        </Link>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) rotate(-6deg); }
          50% { transform: translateY(-24px) rotate(6deg); }
        }
        .animate-float { animation: float 5s ease-in-out infinite; }

        @keyframes twinkle {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 1; }
        }
        .animate-twinkle { animation: twinkle 3s ease-in-out infinite; }

        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-pulse-slow { animation: pulse-slow 3s ease-in-out infinite; }

        @keyframes shoot {
          0% { transform: translateX(-10%) translateY(0); opacity: 0; }
          10% { opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translateX(120vw) translateY(60vh); opacity: 0; }
        }
        .animate-shoot { animation: shoot 6s linear infinite; }
      `}</style>
    </div>
  )
}

function Astronaut() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* backpack */}
      <rect x="40" y="44" width="40" height="38" rx="12" fill="#cbd5e1" />
      {/* body */}
      <rect x="44" y="50" width="32" height="40" rx="14" fill="#f1f5f9" />
      {/* helmet */}
      <circle cx="60" cy="42" r="24" fill="#e2e8f0" />
      <circle cx="60" cy="42" r="18" fill="#1e293b" />
      <circle cx="60" cy="42" r="18" fill="url(#visor)" fillOpacity="0.9" />
      {/* visor highlight */}
      <ellipse cx="53" cy="36" rx="6" ry="8" fill="#ffffff" fillOpacity="0.35" />
      {/* arms */}
      <rect x="30" y="54" width="16" height="11" rx="5.5" fill="#f1f5f9" transform="rotate(-20 30 54)" />
      <rect x="74" y="52" width="16" height="11" rx="5.5" fill="#f1f5f9" transform="rotate(20 90 57)" />
      {/* legs */}
      <rect x="48" y="84" width="11" height="20" rx="5.5" fill="#f1f5f9" transform="rotate(8 48 84)" />
      <rect x="62" y="84" width="11" height="20" rx="5.5" fill="#f1f5f9" transform="rotate(-8 73 84)" />
      <defs>
        <linearGradient id="visor" x1="42" y1="24" x2="78" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60a5fa" />
          <stop offset="0.5" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
    </svg>
  )
}

const STARS = Array.from({ length: 40 }, (_, i) => {
  // deterministic pseudo-random so layout is stable
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1
  return {
    x: r(1) * 100,
    y: r(2) * 100,
    size: 1 + r(3) * 2,
    delay: r(4) * 3,
    opacity: 0.3 + r(5) * 0.7,
  }
})
