import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  api, ApiError, getPending, getToken, isLimitReached, setToken, subscribePending,
  type AdminUser, type Block, type Leader, type Profile, type QuizData, type Result, type Role,
  type Stats, type Test, type User,
} from './api'

type Route =
  | { page: 'tests' }
  | { page: 'blocks'; test: Test }
  | { page: 'quiz'; blockId: number | string; test: Test; random?: boolean }
  | { page: 'result'; result: Result; test: Test }
  | { page: 'leaderboard' }
  | { page: 'profile' }
  | { page: 'admin' }
  | { page: 'upload' }

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Что-то пошло не так')
const LIMIT_MSG = 'Бесплатный лимит исчерпан. Чтобы продолжить, оформите премиум через администратора.'
const ROLE_LABEL: Record<Role, string> = { user: 'Обычный', premium: 'Премиум', admin: 'Админ' }
const ADMIN_TG = 'https://t.me/frontendMmM'
const AUTO_NEXT_MS = 1500
const TEST_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#a3e635', '#fbbf24', '#60a5fa', '#fb923c', '#34d399']
const TEST_ICONS = ['book', 'brain', 'layers', 'flag'] as const
const testColor = (id: number) => TEST_COLORS[id % TEST_COLORS.length]
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/* ---------- Иконки ---------- */
const ICONS = {
  book: <path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zm0 0A2 2 0 0 0 6 21h13" />,
  trophy: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />,
  user: <path d="M20 21a8 8 0 0 0-16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sliders: <path d="M4 7h9m4 0h3M4 17h3m4 0h9M15 5v4M9 15v4" />,
  right: <path d="M5 12h14M13 6l6 6-6 6" />,
  left: <path d="M19 12H5M11 18l-6-6 6-6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  shuffle: <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />,
  layers: <path d="M12 3 2 8l10 5 10-5zM2 13l10 5 10-5" />,
  check: <path d="M5 13l4 4L19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  flame: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  redo: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  sun: <path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />,
  moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
  brain: <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4a3 3 0 0 0-3 0zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" />,
} as const

function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

/** Загружает данные при монтировании и даёт состояние loading/error. */
function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errMsg(e)))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading }
}

/** Плавный подсчёт числа от 0 до target. */
function useCountUp(target: number, ms = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return value
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: ((i * 13) % 10) / 12,
        dur: 2.2 + ((i * 7) % 10) / 5,
        color: ['#4f46e5', '#0ea5e9', '#f59e0b', '#ef476f', '#10b981'][i % 5],
      })),
    [],
  )
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }} />
      ))}
    </div>
  )
}

/** Тонкая полоса сверху, пока есть активные запросы к API. */
function TopLoader() {
  const pending = useSyncExternalStore(subscribePending, getPending)
  return <div className={pending > 0 ? 'toploader on' : 'toploader'} aria-hidden="true" />
}

function Status({ loading, error }: { loading: boolean; error: string }) {
  if (loading) {
    return (
      <div role="status" aria-label="Загрузка" className="grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card skeleton">
            <div className="sk-line" style={{ width: 46, height: 46, borderRadius: 13 }} />
            <div className="sk-line" style={{ width: '55%', height: 20 }} />
            <div className="sk-line" style={{ width: '85%' }} />
          </div>
        ))}
      </div>
    )
  }
  if (error) return <div className="error">{error}</div>
  return null
}

function RoleBadge({ role }: { role: Role }) {
  return <span className={`badge role role-${role}`}>{ROLE_LABEL[role]}</span>
}

/** Остаток бесплатных ответов (только для обычных пользователей). */
function LimitNote({ role, left, limit }: { role?: Role; left?: number | null; limit?: number | null }) {
  if (role !== 'user' || left == null || limit == null) return null
  return (
    <div className={left > 0 ? 'limit-note' : 'limit-note out'}>
      {left > 0
        ? `Бесплатных ответов осталось: ${left} из ${limit}`
        : <>Бесплатный лимит исчерпан — <a href={ADMIN_TG} target="_blank" rel="noopener noreferrer">обратитесь к администратору</a></>}
    </div>
  )
}

/** Ссылка на Telegram администратора для получения премиума. */
function ContactAdmin() {
  return (
    <a className="tg-btn" href={ADMIN_TG} target="_blank" rel="noopener noreferrer">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21.9 4.3 18.7 19.5c-.2 1-.9 1.3-1.7.8l-4.8-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13 1.8 11.5c-1-.3-1-1 .2-1.5L20.3 3c.9-.3 1.6.2 1.6 1.3z" />
      </svg>
      <span className="tg-text">
        <b>Написать администратору</b>
        <small>Telegram · @frontendMmM</small>
      </span>
      <Icon name="right" size={18} />
    </a>
  )
}

function Avatar({ name, big }: { name: string; big?: boolean }) {
  return <span className={big ? 'avatar big' : 'avatar'}>{name.slice(0, 1)}</span>
}

function Head({ eyebrow, title, sub }: { eyebrow?: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <header className="page-head">
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {sub && <p>{sub}</p>}
    </header>
  )
}

function ThemeToggle({ asTab }: { asTab?: boolean }) {
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  )
  const toggle = () => {
    const t = theme === 'light' ? 'dark' : 'light'
    setTheme(t)
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('theme', t) } catch { /* без сохранения */ }
  }
  return (
    <button className={asTab ? 'tab mobile-only' : 'theme-toggle'} onClick={toggle} aria-label="Сменить тему" title="Сменить тему">
      <Icon name={theme === 'light' ? 'moon' : 'sun'} size={asTab ? 19 : 18} />
      {asTab && 'Тема'}
    </button>
  )
}

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark"><Icon name="brain" size={19} /></span>
      <span>Online Tests</span>
    </span>
  )
}

/* ---------- Вход ---------- */
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reg = mode === 'register'

  const switchMode = () => {
    setMode(reg ? 'login' : 'register')
    setError('')
    setPassword('')
    setPassword2('')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (reg && password !== password2) {
      setError('Пароли не совпадают.')
      return
    }
    setBusy(true)
    try {
      const { token, ...user } = reg
        ? await api.register(username.trim(), password)
        : await api.login(username, password)
      setToken(token)
      onLogin(user)
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <span className="theme-float"><ThemeToggle /></span>
      <div className="login-blobs" aria-hidden="true"><i /><i /><i /></div>
      <form className="login-card" onSubmit={submit}>
        <span className="login-logo"><Icon name="brain" size={30} /></span>
        <h1>{reg ? 'Создайте аккаунт' : 'Добро пожаловать!'}</h1>
        <p className="login-sub">
          {reg ? 'Это займёт меньше минуты' : 'Войдите, чтобы пройти тест и попасть в рейтинг'}
        </p>
        {error && <div className="error">{error}</div>}
        <label htmlFor="u">Логин</label>
        <input id="u" type="text" value={username} autoFocus autoComplete="username"
          placeholder={reg ? 'Минимум 3 символа' : 'Ваш логин'} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="p">Пароль</label>
        <input id="p" type="password" value={password}
          autoComplete={reg ? 'new-password' : 'current-password'}
          placeholder={reg ? 'Минимум 8 символов' : '••••••••'} onChange={(e) => setPassword(e.target.value)} />
        {reg && (
          <>
            <label htmlFor="p2">Повторите пароль</label>
            <input id="p2" type="password" value={password2} autoComplete="new-password"
              placeholder="••••••••" onChange={(e) => setPassword2(e.target.value)} />
          </>
        )}
        <button className="login-btn" disabled={busy || !username || !password || (reg && !password2)}>
          {busy
            ? <><span className="btn-spin" /> {reg ? 'Создаём…' : 'Входим…'}</>
            : reg ? 'Зарегистрироваться' : 'Войти'}
        </button>
        <p className="login-switch">
          {reg ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}{' '}
          <button type="button" onClick={switchMode}>{reg ? 'Войти' : 'Зарегистрироваться'}</button>
        </p>
        <ul className="login-chips">
          <li>⚡ Мгновенная проверка</li>
          <li>🎲 Случайные вопросы</li>
          <li>🏅 Рейтинг</li>
        </ul>
      </form>
    </div>
  )
}

/* ---------- Список тестов ---------- */
function Tests({ go, name }: { go: (r: Route) => void; name: string }) {
  const { data, error, loading } = useLoad(() => api.tests())
  const prof = useLoad<Profile>(() => api.profile())
  return (
    <>
      <Head eyebrow="Тесты" title={`Привет, ${name}`} sub="Выбери тест и проверь свои знания" />
      <LimitNote role={prof.data?.role} left={prof.data?.free_answers_left} limit={prof.data?.free_answers_limit} />
      {prof.data && prof.data.tests_completed > 0 && (
        <div className="mini-stats">
          <div className="card"><b>{prof.data.tests_completed}</b><span>пройдено</span></div>
          <div className="card accent"><b>{prof.data.best_percent}%</b><span>лучший результат</span></div>
          <div className="card"><b>{prof.data.average_percent}%</b><span>средний</span></div>
          <div className="card"><b>{prof.data.leaderboard_rank ? `#${prof.data.leaderboard_rank}` : '—'}</b><span>место в рейтинге</span></div>
        </div>
      )}
      <Status loading={loading} error={error} />
      {data?.length === 0 && <p className="muted">Пока нет активных тестов.</p>}
      <div className="grid">
        {data?.map((t, i) => (
          <div key={t.id} className="card clickable test-card" tabIndex={0} role="button"
            style={{ '--c': testColor(t.id) } as CSSProperties}
            onClick={() => go({ page: 'blocks', test: t })}
            onKeyDown={(e) => e.key === 'Enter' && go({ page: 'blocks', test: t })}>
            <span className="tile"><Icon name={TEST_ICONS[(t.id + i) % TEST_ICONS.length]} size={22} /></span>
            <div>
              <h2>{t.title}</h2>
              {t.description && <p className="desc">{t.description}</p>}
            </div>
            <div className="card-foot">
              <span>{t.block_count} бл.{t.author ? ` · от ${t.author}` : ''}</span>
              <span className="go">Открыть <Icon name="right" size={16} /></span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ---------- Блоки теста ---------- */
function Blocks({ test, go }: { test: Test; go: (r: Route) => void }) {
  const { data, error, loading } = useLoad<Block[]>(() => api.blocks(test.id), [test.id])
  return (
    <div className="narrow" style={{ '--c': testColor(test.id) } as CSSProperties}>
      <button className="link" onClick={() => go({ page: 'tests' })}><Icon name="left" size={18} /> К тестам</button>
      <Head eyebrow="Выберите блок" title={test.title} sub={test.description || undefined} />
      <Status loading={loading} error={error} />
      <div className="card clickable promo list-item" tabIndex={0} role="button"
        onClick={() => go({ page: 'quiz', blockId: `random-${test.id}`, test, random: true })}
        onKeyDown={(e) => e.key === 'Enter' && go({ page: 'quiz', blockId: `random-${test.id}`, test, random: true })}>
        <span className="tile"><Icon name="shuffle" size={22} /></span>
        <div className="grow">
          <h2>Случайный тест</h2>
          <span className="muted">20 случайных вопросов из всего теста</span>
        </div>
        <Icon name="right" />
      </div>
      {data?.map((b) => (
        <div key={b.id} className="card clickable list-item" tabIndex={0} role="button"
          onClick={() => go({ page: 'quiz', blockId: b.id, test })}
          onKeyDown={(e) => e.key === 'Enter' && go({ page: 'quiz', blockId: b.id, test })}>
          <span className="tile"><Icon name="layers" size={22} /></span>
          <div className="grow">
            <h2>{b.title}</h2>
            <span className="muted">{b.question_count} вопросов</span>
          </div>
          <span className="chev"><Icon name="chevron" /></span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Прохождение ---------- */
function Quiz({ route, go }: { route: Extract<Route, { page: 'quiz' }>; go: (r: Route) => void }) {
  const { data, error, loading } = useLoad<QuizData>(
    () => (route.random ? api.randomBlock(route.test.id) : api.block(Number(route.blockId))),
    [route.blockId],
  )
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [correctId, setCorrectId] = useState<number | null>(null)
  const [chosen, setChosen] = useState<{ question_id: number; answer_id: number }[]>([])
  const [streak, setStreak] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [limitMsg, setLimitMsg] = useState('')
  const [left, setLeft] = useState<number | null>(null)

  const q = data?.questions[index]
  const checked = picked !== null && correctId !== null
  const isRight = checked && picked === correctId

  const choose = async (answerId: number) => {
    if (!q || picked !== null || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await api.checkAnswer(route.blockId, q.id, answerId)
      setPicked(answerId)
      setCorrectId(r.correct_answer_id ?? answerId)
      setStreak((s) => (r.is_correct ? s + 1 : 0))
      setChosen((c) => [...c, { question_id: q.id, answer_id: answerId }])
      setLeft(r.free_answers_left ?? null)
    } catch (e) {
      if (isLimitReached(e)) setLimitMsg(errMsg(e) || LIMIT_MSG)
      else setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const next = async () => {
    if (!data) return
    if (index + 1 < data.questions.length) {
      if (left === 0) {
        // Лимит исчерпан на этом ответе: дальше нужен премиум.
        setLimitMsg(LIMIT_MSG)
        return
      }
      setIndex(index + 1)
      setPicked(null)
      setCorrectId(null)
      return
    }
    setBusy(true)
    setErr('')
    try {
      const result = await api.submit(route.blockId, chosen)
      go({ page: 'result', result, test: route.test })
    } catch (e) {
      if (isLimitReached(e)) setLimitMsg(errMsg(e) || LIMIT_MSG)
      else setErr(errMsg(e))
      setBusy(false)
    }
  }

  const finishEarly = async () => {
    setBusy(true)
    setErr('')
    try {
      const result = await api.submit(route.blockId, chosen)
      go({ page: 'result', result, test: route.test })
    } catch (e) {
      setErr(errMsg(e))
      setBusy(false)
    }
  }

  // После ответа через 1.5 с сам открывается следующий вопрос (или отправка результата).
  useEffect(() => {
    if (!checked || limitMsg) return
    const t = setTimeout(next, AUTO_NEXT_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, index])

  // Клавиатура: 1–9 — выбрать вариант, Enter — далее.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[1-9]$/.test(e.key) && q && picked === null) {
        const a = q.answers[Number(e.key) - 1]
        if (a) choose(a.id)
      } else if (e.key === 'Enter' && checked && !busy && el.tagName !== 'BUTTON') {
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="narrow">
      <button className="link" onClick={() => go({ page: 'blocks', test: route.test })}>
        <Icon name="left" size={18} /> Выйти из теста
      </button>
      <Status loading={loading} error={error} />
      {limitMsg && (
        <div className="card paywall">
          <span className="paywall-icon"><Icon name="flag" size={26} /></span>
          <h2>Лимит бесплатных ответов исчерпан</h2>
          <p className="muted">{limitMsg}</p>
          <p className="muted">Обратитесь к администратору, чтобы получить премиум-доступ.</p>
          {err && <div className="error">{err}</div>}
          <div className="actions" style={{ justifyContent: 'center' }}>
            <ContactAdmin />
            {chosen.length > 0 && (
              <button className="primary" disabled={busy} onClick={finishEarly}>
                Показать результат ({chosen.length})
              </button>
            )}
            <button onClick={() => go({ page: 'tests' })}>К тестам</button>
          </div>
        </div>
      )}
      {data && data.questions.length === 0 && <p className="muted">В этом блоке нет вопросов.</p>}
      {data && q && !limitMsg && (
        <>
          <div className="q-meta">
            <span className="count">Вопрос {index + 1} из {data.questions.length}</span>
            {streak >= 2 && <span className="streak" key={streak}><Icon name="flame" size={15} /> {streak} подряд</span>}
          </div>
          <div className="progress">
            <div style={{ width: `${((index + (checked ? 1 : 0)) / data.questions.length) * 100}%` }} />
          </div>
          {err && <div className="error">{err}</div>}
          <div className="card question" key={q.id}>
            <h2>{q.text}</h2>
            {q.answers.map((a, i) => {
              let cls = 'option'
              if (checked && a.id === correctId) cls += ' correct'
              else if (checked && a.id === picked) cls += ' wrong'
              return (
                <button key={a.id} className={cls} disabled={busy || picked !== null}
                  onClick={() => choose(a.id)}>
                  <span className="key">{LETTERS[i] ?? i + 1}</span>
                  <span className="txt">{a.text}</span>
                </button>
              )
            })}
            {checked && (
              <p className={isRight ? 'feedback good' : 'feedback bad'}>
                <Icon name={isRight ? 'check' : 'x'} size={18} />
                {isRight ? 'Верно!' : 'Неверно — правильный ответ подсвечен'}
              </p>
            )}
          </div>
          <div className="quiz-actions">
            <span className="hint">Клавиши 1–{Math.min(q.answers.length, 9)} — выбор ответа</span>
            {checked && err && (
              <button className="primary" disabled={busy} onClick={next}>Повторить отправку</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- Результат ---------- */
function ResultView({ result, test, go }: { result: Result; test: Test; go: (r: Route) => void }) {
  const percent = useCountUp(result.percent)
  const verdict =
    result.percent >= 90 ? 'Великолепно!' :
    result.percent >= 70 ? 'Отличный результат!' :
    result.percent >= 50 ? 'Неплохо, можно лучше' : 'Не сдавайтесь, попробуйте ещё'
  const C = 2 * Math.PI * 52
  const tone = result.percent >= 70 ? 'good' : result.percent >= 50 ? '' : 'low'
  return (
    <div className="narrow">
      {result.percent >= 70 && <Confetti />}
      <div className="card result-card">
        <div className={`ring ${tone}`}>
          <svg viewBox="0 0 120 120">
            <circle className="track" cx="60" cy="60" r="52" fill="none" strokeWidth="10" />
            <circle className="bar" cx="60" cy="60" r="52" fill="none" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - percent / 100)} />
          </svg>
          <div className="num">{percent}%</div>
        </div>
        <div className="verdict">{verdict}</div>
        <p className="muted">{result.score} из {result.total} правильных ответов</p>
        {result.free_answers_left === 0 && <p className="limit-note out">{LIMIT_MSG}</p>}
        <div className="actions" style={{ justifyContent: 'center', marginTop: 18 }}>
          {result.free_answers_left === 0 && <ContactAdmin />}
          <button className="primary" onClick={() => go({ page: 'blocks', test })}><Icon name="redo" size={18} /> Ещё раз</button>
          <button onClick={() => go({ page: 'tests' })}>К тестам</button>
          <button onClick={() => go({ page: 'leaderboard' })}><Icon name="trophy" size={18} /> Рейтинг</button>
        </div>
      </div>
      {result.answers && result.answers.length > 0 && <h2 style={{ margin: '24px 0 12px' }}>Разбор ответов</h2>}
      {result.answers?.map((a, i) => (
        <div key={i} className="card answer-row">
          <span className={`mark ${a.is_correct ? 'good' : 'bad'}`}>
            <Icon name={a.is_correct ? 'check' : 'x'} size={16} />
          </span>
          <div>
            <p className="q">{a.question}</p>
            <p className={`mine ${a.is_correct ? 'good' : 'bad'}`}>Ваш ответ: {a.selected_answer}</p>
            {!a.is_correct && <p className="muted" style={{ margin: 0 }}>Правильно: {a.correct_answer}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Рейтинг ---------- */
function Leaderboard() {
  const [testId, setTestId] = useState<number | null>(null)
  const tests = useLoad<Test[]>(() => api.tests())
  const { data, error, loading } = useLoad(() => api.leaderboard(testId), [testId])
  const list: Leader[] = data?.results ?? []
  return (
    <div className="narrow">
      <Head eyebrow="Лучшие результаты" title="Рейтинг" />
      <div className="lb-filter" role="tablist" aria-label="Рейтинг по тесту">
        <button role="tab" aria-selected={testId === null}
          className={testId === null ? 'chip active' : 'chip'} onClick={() => setTestId(null)}>
          Все тесты
        </button>
        {tests.data?.map((t) => (
          <button key={t.id} role="tab" aria-selected={testId === t.id}
            className={testId === t.id ? 'chip active' : 'chip'} onClick={() => setTestId(t.id)}>
            {t.title}
          </button>
        ))}
      </div>
      <Status loading={loading} error={error} />
      {!loading && !error && list.length === 0 && (
        <p className="muted">{testId ? 'Этот тест ещё никто не проходил.' : 'Пока никто не проходил тесты.'}</p>
      )}
      {list.map((l) => (
        <div key={l.rank} className={`card lb-row ${l.rank === 1 ? 'lb-1' : ''}`}>
          <span className={`rank ${l.rank <= 3 ? `r${l.rank}` : ''}`}>{l.rank}</span>
          <Avatar name={l.username} />
          <div className="who">
            <b>{l.username}</b>
            <span className="muted">{l.test_title}{l.block_title ? ` · ${l.block_title}` : ''}</span>
          </div>
          <div className="pct">{l.percent}%<small>{l.score}/{l.total}</small></div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Профиль ---------- */
function ProfileView() {
  const { data, error, loading } = useLoad<Profile>(() => api.profile())
  const [nick, setNick] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState<Profile | null>(null)
  const p = saved ?? data

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setMsg(''); setErr('')
    try {
      setSaved(await api.setNickname((nick ?? p?.nickname ?? '').trim()))
      setNick(null)
      setMsg('Никнейм сохранён')
    } catch (e2) {
      setErr(errMsg(e2))
    }
  }

  return (
    <div className="narrow">
      <Status loading={loading} error={error} />
      {p && (
        <>
          <div className="card profile-head">
            <Avatar name={p.nickname || p.username} big />
            <div>
              <h1>{p.nickname || p.username}</h1>
              <p className="muted">@{p.username}{p.email ? ` · ${p.email}` : ''}</p>
              <RoleBadge role={p.role} />
            </div>
          </div>
          <LimitNote role={p.role} left={p.free_answers_left} limit={p.free_answers_limit} />
          <div className="card stats">
            <div className="stat"><b>{p.tests_completed}</b><span className="muted">пройдено</span></div>
            <div className="stat"><b>{p.best_percent}%</b><span className="muted">лучший</span></div>
            <div className="stat"><b>{p.average_percent}%</b><span className="muted">средний</span></div>
            <div className="stat"><b>{p.leaderboard_rank ? `#${p.leaderboard_rank}` : '—'}</b><span className="muted">место</span></div>
          </div>
          <form className="card" onSubmit={save}>
            <h2>Никнейм</h2>
            {msg && <div className="ok">{msg}</div>}
            {err && <div className="error">{err}</div>}
            <label htmlFor="nick">Как вас показывать в рейтинге</label>
            <input id="nick" type="text" value={nick ?? p.nickname ?? ''} onChange={(e) => setNick(e.target.value)} />
            <button className="primary" disabled={nick === null}>Сохранить</button>
          </form>
        </>
      )}
    </div>
  )
}

/* ---------- Пользователи и роли (админка) ---------- */
function UsersAdmin({ me }: { me: User }) {
  const { data, error, loading } = useLoad<AdminUser[]>(() => api.adminUsers())
  const [rows, setRows] = useState<AdminUser[] | null>(null)
  const [query, setQuery] = useState('')
  const [savingId, setSavingId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const list = rows ?? data ?? []
  const shown = list.filter((u) => u.username.toLowerCase().includes(query.trim().toLowerCase()))

  const change = async (u: AdminUser, role: Role) => {
    if (role === u.role) return
    setSavingId(u.id); setErr(''); setOk('')
    try {
      const r = await api.setRole(u.id, role)
      setRows(list.map((x) => (x.id === u.id ? { ...x, role: r.role } : x)))
      setOk(`${u.username}: роль «${ROLE_LABEL[r.role]}»`)
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSavingId(null)
    }
  }

  // Менять нельзя: себя, суперпользователей; админов — только суперпользователь.
  const locked = (u: AdminUser) =>
    u.username === me.username || u.is_superuser || (u.role === 'admin' && !me.is_superuser)

  return (
    <div className="card">
      <h2>Пользователи и роли</h2>
      <p className="muted">Премиум-доступ снимает лимит бесплатных ответов.</p>
      {ok && <div className="ok">{ok}</div>}
      {(err || error) && <div className="error">{err || error}</div>}
      <input type="text" value={query} placeholder="Поиск по логину" onChange={(e) => setQuery(e.target.value)} />
      {loading && <p className="muted">Загрузка…</p>}
      <div className="users">
        {shown.map((u) => (
          <div key={u.id} className="user-row">
            <Avatar name={u.username} />
            <div className="grow">
              <b>{u.username}</b>
              <span className="muted">{u.email || 'без email'}</span>
            </div>
            {locked(u) ? (
              <RoleBadge role={u.role} />
            ) : (
              <select value={u.role} disabled={savingId === u.id} aria-label={`Роль ${u.username}`}
                onChange={(e) => change(u, e.target.value as Role)}>
                <option value="user">{ROLE_LABEL.user}</option>
                <option value="premium">{ROLE_LABEL.premium}</option>
                {me.is_superuser && <option value="admin">{ROLE_LABEL.admin}</option>}
              </select>
            )}
          </div>
        ))}
        {!loading && shown.length === 0 && <p className="muted">Никого не найдено.</p>}
      </div>
    </div>
  )
}

/* ---------- Загрузка теста (админ и премиум) ---------- */
function UploadTest({ premiumOnly }: { premiumOnly?: boolean }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return
    setBusy(true); setErr(''); setOk(''); setProgress(0)
    try {
      const r = await api.upload(title, description, file, setProgress)
      setOk(`Тест «${r.title}» создан: ${r.questions_count} вопросов, ${r.blocks_count} блоков`)
      setTitle(''); setDescription(''); setFile(null)
    } catch (e2) {
      setErr(errMsg(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{premiumOnly ? 'Новый тест' : 'Загрузить тест'}</h2>
      {ok && <div className="ok">{ok}</div>}
      {err && <div className="error">{err}</div>}
      <label htmlFor="t">Название</label>
      <input id="t" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="d">Описание</label>
      <textarea id="d" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <label htmlFor="f">Файл с вопросами (.txt или .docx)</label>
      <input id="f" type="file" accept=".txt,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <details className="format-hint">
        <summary>Как оформить файл</summary>
        <pre>{`+++++
Текст вопроса
======
Неверный вариант
======
#Верный вариант (начинается с #)
======
Ещё вариант
======`}</pre>
        <p className="muted">
          Каждый вопрос начинается с <code>+++++</code>, части разделяются строкой <code>=====</code>.
          Правильный ответ помечается <code>#</code>. Длинные тесты делятся на блоки по 25 вопросов.
        </p>
      </details>
      {busy && (
        <div style={{ marginBottom: 14 }}>
          <div className="progress" style={{ marginBottom: 6 }}><div style={{ width: `${progress}%` }} /></div>
          <span className="muted">
            {progress < 100 ? `Отправка файла… ${progress}%` : 'Обработка теста на сервере…'}
          </span>
        </div>
      )}
      <button className="primary" disabled={busy || !title.trim() || !file}>
        {busy ? <><span className="btn-spin" /> Загрузка…</> : 'Загрузить'}
      </button>
    </form>
  )
}

/* ---------- Добавление теста (премиум) ---------- */
function AddTest() {
  return (
    <div className="narrow">
      <Head eyebrow="Премиум" title="Добавить тест" sub="Загрузите свой тест, он появится в общем списке" />
      <UploadTest premiumOnly />
    </div>
  )
}

/* ---------- Админка ---------- */
function Admin({ user }: { user: User }) {
  const stats = useLoad<Stats | null>(() => (user.is_superuser ? api.stats() : Promise.resolve(null)), [user.is_superuser])
  const s = stats.data
  return (
    <div className="narrow">
      <Head eyebrow="Управление" title="Админка" />
      {s && (
        <div className="card stats">
          <div className="stat"><b>{s.users_total}</b><span className="muted">пользователей</span></div>
          <div className="stat"><b>{s.users_online}</b><span className="muted">онлайн</span></div>
          <div className="stat"><b>{s.tests_total}</b><span className="muted">тестов</span></div>
          <div className="stat"><b>{s.questions_total}</b><span className="muted">вопросов</span></div>
          <div className="stat"><b>{s.results_total}</b><span className="muted">прохождений</span></div>
        </div>
      )}
      <UsersAdmin me={user} />
      <UploadTest />
    </div>
  )
}

/* ---------- Каркас ---------- */
function Shell({ user, route, go, onLogout, children }: {
  user: User; route: Route; go: (r: Route) => void; onLogout: () => void; children: ReactNode
}) {
  // blocks/quiz/result — внутри раздела «Тесты»
  const section: Route['page'] =
    route.page === 'blocks' || route.page === 'quiz' || route.page === 'result' ? 'tests' : route.page
  const tab = (page: Route['page'], label: string, icon: keyof typeof ICONS) => (
    <button className={section === page ? 'tab active' : 'tab'} aria-current={section === page ? 'page' : undefined}
      onClick={() => go({ page } as Route)}>
      <Icon name={icon} size={19} />
      {label}
    </button>
  )
  return (
    <>
      <TopLoader />
      <nav className="nav">
        <div className="nav-inner">
          <Brand />
          <div className="nav-tabs">
            {tab('tests', 'Тесты', 'book')}
            {tab('leaderboard', 'Рейтинг', 'trophy')}
            {tab('profile', 'Профиль', 'user')}
            {user.role === 'premium' && tab('upload', 'Добавить тест', 'plus')}
            {user.is_staff && tab('admin', 'Админка', 'sliders')}
            <ThemeToggle asTab />
            <button className="tab mobile-only" onClick={onLogout}><Icon name="logout" size={19} />Выйти</button>
          </div>
          <span className="spacer" />
          <div className="nav-user">
            <ThemeToggle />
            <Avatar name={user.username} />
            <span className="name">{user.username}</span>
            {user.role !== 'user' && <RoleBadge role={user.role} />}
            <button onClick={onLogout} aria-label="Выйти" title="Выйти"><Icon name="logout" size={18} /></button>
          </div>
        </div>
      </nav>
      <main className="container page" key={route.page === 'quiz' ? `q${route.blockId}` : route.page}>
        {children}
      </main>
    </>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(!!getToken())
  const [route, setRoute] = useState<Route>({ page: 'tests' })

  useEffect(() => {
    if (!getToken()) return
    api.me()
      .then(setUser)
      .catch((e) => { if (e instanceof ApiError && e.status === 401) setToken(null) })
      .finally(() => setBooting(false))
  }, [])

  const logout = async () => {
    try { await api.logout() } catch { /* токен всё равно сбрасываем */ }
    setToken(null)
    setUser(null)
    setRoute({ page: 'tests' })
  }

  if (booting) return <div className="container"><div className="spinner" /></div>
  if (!user) return <Login onLogin={setUser} />

  let view: ReactNode
  switch (route.page) {
    case 'tests': view = <Tests go={setRoute} name={user.username} />; break
    case 'blocks': view = <Blocks key={route.test.id} test={route.test} go={setRoute} />; break
    case 'quiz': view = <Quiz key={String(route.blockId)} route={route} go={setRoute} />; break
    case 'result': view = <ResultView result={route.result} test={route.test} go={setRoute} />; break
    case 'leaderboard': view = <Leaderboard />; break
    case 'profile': view = <ProfileView />; break
    case 'admin': view = <Admin user={user} />; break
    case 'upload': view = user.role === 'premium' || user.is_staff ? <AddTest /> : <Tests go={setRoute} name={user.username} />; break
  }

  return <Shell user={user} route={route} go={setRoute} onLogout={logout}>{view}</Shell>
}
