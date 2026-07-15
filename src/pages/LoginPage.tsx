import { useSearchParams } from 'react-router-dom'

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: '登入失敗，請再試一次',
  auth_unavailable: 'PG72 ID 暫時無法使用，請稍後再試',
  banned: '此帳號已被停權',
  identity_conflict: '此電子信箱已綁定其他 PG72 ID 帳號',
  invalid_state: '登入流程異常，請再試一次',
}

export default function LoginPage() {
  const [params] = useSearchParams()
  const error = params.get('error')

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">短網址服務</h1>
          <p className="text-slate-400 text-sm mt-1">登入即可建立與管理你的短網址</p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {ERROR_MESSAGES[error] ?? '發生未知錯誤'}
          </div>
        )}

        <a
          href="/api/auth/login"
          className="flex items-center justify-center gap-3 w-full px-4 py-3 rounded-xl bg-white text-gray-800 font-medium text-sm hover:bg-gray-100 transition-colors"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-900 text-[9px] font-bold text-white" aria-hidden="true">
            ID
          </span>
          使用 PG72 ID 登入
        </a>

        <p className="mt-6 text-center text-xs text-slate-600">
          任何人都可以登入建立短網址
        </p>
      </div>
    </div>
  )
}
