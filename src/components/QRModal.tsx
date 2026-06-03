import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

interface Props {
  url: string
  slug: string
  onClose: () => void
}

export default function QRModal({ url, slug, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const download = () => {
    const canvas = wrapRef.current?.querySelector('canvas')
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `qrcode-${slug}.png`
    a.click()
  }

  const copyUrl = () => navigator.clipboard.writeText(url)

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: '短網址', url })
      } catch {
        /* user cancelled */
      }
    } else {
      copyUrl()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs bg-slate-900 border border-slate-700 rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white">分享 QR Code</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div ref={wrapRef} className="bg-white rounded-xl p-4 flex items-center justify-center">
          <QRCodeCanvas value={url} size={200} level="M" includeMargin={false} />
        </div>

        <p className="mt-3 text-center text-xs text-blue-400 font-mono break-all">{url}</p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            onClick={download}
            className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            下載
          </button>
          <button
            onClick={copyUrl}
            className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            複製
          </button>
          <button
            onClick={share}
            className="flex flex-col items-center gap-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            分享
          </button>
        </div>
      </div>
    </div>
  )
}
