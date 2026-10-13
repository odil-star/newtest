// В dev используется proxy из vite.config.ts; для прода задайте VITE_API_URL
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

export type Role = 'user' | 'premium' | 'admin'
export type FreeLimit = {
  free_answers_limit: number | null
  free_answers_used: number | null
  free_answers_left: number | null
}
export type User = { username: string; role: Role; is_staff: boolean; is_superuser: boolean } & Partial<FreeLimit>
export type AdminUser = {
  id: number; username: string; email: string; role: Role; is_superuser: boolean; date_joined: string
}
export type Test = { id: number; title: string; description: string; block_count: number; author?: string | null }
export type Block = { id: number; title: string; order: number; question_count: number }
export type Answer = { id: number; text: string }
export type Question = { id: number; text: string; answers: Answer[] }
export type QuizData = { id: number | string; title: string; test_title?: string; test_id?: number; questions: Question[] }
export type AnswerDetail = { question: string; selected_answer: string; correct_answer: string; is_correct: boolean }
export type Result = {
  result_id?: number; score: number; total: number; percent: number; block_title?: string; answers?: AnswerDetail[]
} & Partial<FreeLimit>
export type Leader = { rank: number; username: string; percent: number; score: number; total: number; test_title: string; block_title: string }
export type Profile = {
  username: string; role: Role; nickname: string; email: string; tests_completed: number
  best_percent: number; average_percent: number; leaderboard_rank: number | null
} & Partial<FreeLimit>
export type Stats = { users_total: number; users_online: number; tests_total: number; questions_total: number; results_total: number }

const TOKEN_KEY = 'token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Бесплатный лимит исчерпан: нужен премиум от администратора (HTTP 402). */
export const isLimitReached = (e: unknown) =>
  e instanceof ApiError && (e.status === 402 || e.code === 'free_limit_reached')

// Счётчик активных запросов — для глобальной полосы загрузки
let pending = 0
const listeners = new Set<() => void>()
const track = (delta: number) => {
  pending += delta
  listeners.forEach((l) => l())
}
export const getPending = () => pending
export const subscribePending = (cb: () => void) => {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function errorFrom(data: unknown, status: number) {
  const d = (data ?? {}) as Record<string, unknown>
  const msg =
    (typeof d.detail === 'string' && d.detail) ||
    Object.values(d).flat().filter((v) => typeof v === 'string').join(' ')
  return new ApiError(
    msg || `Ошибка ${status}`, status, typeof d.code === 'string' ? d.code : undefined,
  )
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Token ${token}`
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json'

  track(1)
  try {
    const res = await fetch(BASE + path, { ...init, headers })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw errorFrom(data, res.status)
    return data as T
  } finally {
    track(-1)
  }
}

type UploadResult = { test_id: number; title: string; questions_count: number; blocks_count: number }

/** Загрузка файла через XHR, чтобы показывать прогресс отправки. */
function uploadWithProgress(
  title: string, description: string, file: File, onProgress: (percent: number) => void,
) {
  return new Promise<UploadResult>((resolve, reject) => {
    const fd = new FormData()
    fd.append('title', title)
    fd.append('description', description)
    fd.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', BASE + '/tests/upload/')
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Token ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onerror = () => reject(new ApiError('Не удалось отправить файл', 0))
    xhr.onload = () => {
      let data: unknown = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* не JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as UploadResult)
      else reject(errorFrom(data, xhr.status))
    }
    track(1)
    xhr.onloadend = () => track(-1)
    xhr.send(fd)
  })
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const api = {
  login: (username: string, password: string) =>
    post<User & { token: string }>('/login/', { username, password }),
  register: (username: string, password: string) =>
    post<User & { token: string }>('/register/', { username, password }),
  logout: () => post<unknown>('/logout/', {}),
  me: () => request<User>('/me/'),
  tests: () => request<Test[]>('/tests/'),
  blocks: (testId: number) => request<Block[]>(`/tests/${testId}/blocks/`),
  block: (id: number) => request<QuizData>(`/blocks/${id}/`),
  randomBlock: (testId: number, count = 20) =>
    request<QuizData>(`/tests/${testId}/random-block/?count=${count}`),
  checkAnswer: (blockId: number | string, questionId: number, answerId: number) =>
    post<{ is_correct: boolean; correct_answer_id: number | null } & Partial<FreeLimit>>(
      String(blockId).startsWith('random-')
        ? '/random-test/check-answer/'
        : `/blocks/${blockId}/check-answer/`,
      { question_id: questionId, answer_id: answerId },
    ),
  submit: (blockId: number | string, answers: { question_id: number; answer_id: number }[]) =>
    post<Result>(
      String(blockId).startsWith('random-') ? '/random-test/submit/' : `/blocks/${blockId}/submit/`,
      { answers },
    ),
  result: (id: number) => request<Result>(`/results/${id}/`),
  leaderboard: (testId?: number | null) =>
    request<{ results: Leader[] }>(testId ? `/leaderboard/?test_id=${testId}` : '/leaderboard/'),
  profile: () => request<Profile>('/profile/'),
  setNickname: (nickname: string) =>
    request<Profile>('/profile/', { method: 'PATCH', body: JSON.stringify({ nickname }) }),
  stats: () => request<Stats>('/admin/stats/'),
  adminUsers: () => request<AdminUser[]>('/admin/users/'),
  setRole: (userId: number, role: Role) =>
    request<{ id: number; username: string; role: Role }>(`/admin/users/${userId}/role/`, {
      method: 'PATCH', body: JSON.stringify({ role }),
    }),
  upload: uploadWithProgress,
}
