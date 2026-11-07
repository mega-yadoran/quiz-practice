import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, download } from './api';
import { Icon } from './icons';
import { parseQuestionsCsv, questionsCsv, sampleQuestions } from '../shared/csv';
import type { PracticeState, Question, QuestionRow, Settings, Stats } from '../shared/model';
import './style.css';

type Page = 'practice' | 'questions' | 'favorites' | 'history' | 'settings';
const pages: { id: Page; label: string; icon: string; en: string }[] = [
  { id: 'practice', label: '練習する', icon: 'headphones', en: 'PRACTICE' },
  { id: 'questions', label: '問題を管理', icon: 'book', en: 'QUESTION LIBRARY' },
  { id: 'favorites', label: 'お気に入り', icon: 'star', en: 'FAVORITES' },
  { id: 'history', label: '学習の記録', icon: 'history', en: 'YOUR PROGRESS' },
  { id: 'settings', label: '設定', icon: 'settings', en: 'SETTINGS' },
];
function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="error" role="alert">{error}{retry && <button className="text-button" onClick={retry}>もう一度読み込む</button>}</div>;
}
function Loading() { return <div className="loading" role="status"><span className="spinner" />読み込んでいます…</div>; }
function Empty({ icon = 'book', title, children }: { icon?: string; title: string; children?: React.ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={32} /></span><h3>{title}</h3>{children}</div>;
}
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  if (total <= 20) return null;
  return <div className="pager"><button className="button small secondary" disabled={page === 1} onClick={() => onChange(page - 1)}>前へ</button><span>{page} / {Math.ceil(total / 20)} ページ</span><button className="button small secondary" disabled={page * 20 >= total} onClick={() => onChange(page + 1)}>次へ</button></div>;
}

function App() {
  const [page, setPage] = useState<Page>('practice');
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<Settings>({ rate: 1, showQuestion: false });
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const load = useCallback(async () => {
    try {
      const [s, prefs, me] = await Promise.all([api<Stats>('/stats'), api<Settings>('/settings'), api<{ email: string }>('/me')]);
      setStats(s); setSettings(prefs); setEmail(me.email); setError('');
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load, version]);
  const navigate = (target: Page) => { window.speechSynthesis?.cancel(); setPage(target); window.scrollTo(0, 0); };
  const current = pages.find(p => p.id === page)!;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('practice'); }}><span className="brand-mark">Q<span /></span><span>Quiz Practice<small>わたしのクイズ練習帳</small></span></a>
      <div className="sidebar-label">MY WORKSPACE</div>
      <nav aria-label="メインナビゲーション">{pages.map(p => <button key={p.id} className={`nav-item ${page === p.id ? 'active' : ''}`} aria-current={page === p.id ? 'page' : undefined} onClick={() => navigate(p.id)}><Icon name={p.icon} /><span>{p.label}</span>{p.id === 'favorites' && !!stats?.favorites && <span className="nav-count">{stats.favorites}</span>}</button>)}</nav>
      <div className="sidebar-note"><span className="tiny-line" /><p>ひとつの「知らない」を、<br />ひとつの「わかった」に。</p><small>ONE QUESTION AT A TIME.</small></div>
      <div className="account"><span className="avatar">Y</span><span>Personal workspace<small title={email}>{email || '接続を確認しています'}</small></span><Icon name="shield" size={16} /></div>
    </aside>
    <main className="main">
      <div className="topbar"><span>MY QUIZ NOTEBOOK <span className="topbar-slash">/</span> {current.en}</span><span className="private-badge"><span />自分だけの練習帳</span></div>
      <div className="content">
        <header className="page-heading"><div><p className="eyebrow">{current.en}</p><h1>{page === 'practice' ? '聴いて、考えて、覚える。' : current.label}</h1><p className="subtitle">{{ practice: '今日も、一問ずつ。自分のペースで知識を積み重ねよう。', questions: '集めた問題を、自分の知識に変えていこう。', favorites: 'もう一度見返したい問題を、ここに。', history: '小さな積み重ねを、振り返ろう。', settings: '心地よく練習するための、自分の設定。' }[page]}</p></div><span className="heading-decoration" aria-hidden="true">{page === 'practice' ? 'Q.' : <Icon name={current.icon} size={44} />}</span></header>
        {error && <ErrorBox error={error} retry={() => void load()} />}
        {page === 'practice' && <Practice settings={settings} stats={stats} refresh={refresh} onQuestions={() => navigate('questions')} />}
        {(page === 'questions' || page === 'favorites') && <Library key={page} favoriteOnly={page === 'favorites'} refresh={refresh} />}
        {page === 'history' && <History stats={stats} />}
        {page === 'settings' && <Preferences settings={settings} onSave={s => { setSettings(s); refresh(); }} />}
        <footer className="page-footer">QUIZ PRACTICE <span>続けるほど、知ることが楽しくなる。</span></footer>
      </div>
    </main>
    <nav className="mobile-nav" aria-label="モバイルナビゲーション">{pages.map(p => <button key={p.id} className={page === p.id ? 'active' : ''} aria-current={page === p.id ? 'page' : undefined} onClick={() => navigate(p.id)}><Icon name={p.icon} size={21} /><span>{p.id === 'questions' ? '問題' : p.id === 'history' ? '記録' : p.id === 'practice' ? '練習' : p.label}</span></button>)}</nav>
  </div>;
}

function Practice({ settings, stats, refresh, onQuestions }: { settings: Settings; stats: Stats | null; refresh: () => void; onQuestions: () => void }) {
  const [state, setState] = useState<PracticeState | null>(null);
  const [stage, setStage] = useState<'ready' | 'reading' | 'answering'>('ready');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [speechError, setSpeechError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const token = useRef(0);
  const cancel = useCallback(() => { token.current++; clearTimeout(watchdog.current); window.speechSynthesis?.cancel(); utterance.current = null; }, []);
  const update = (data: PracticeState) => { setState(data); setAnswer(''); setStage('ready'); };
  const load = async () => {
    setError('');
    try {
      let data = await api<PracticeState>('/practice');
      if (!data.attempt && data.total) data = await api<PracticeState>('/practice/next', { method: 'POST', body: {} });
      update(data);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { void load(); return cancel; }, [cancel]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const start = () => {
    if (!state?.attempt) return;
    setSpeechError(''); cancel();
    if (!('speechSynthesis' in window)) { setSpeechError('このブラウザでは読み上げを利用できません。「文字を見て回答」から練習できます。'); return; }
    const generation = token.current;
    const u = new SpeechSynthesisUtterance(state.attempt.reading || state.attempt.text);
    u.lang = 'ja-JP'; u.rate = settings.rate;
    const voice = speechSynthesis.getVoices().find(v => v.lang === 'ja-JP');
    if (voice) u.voice = voice;
    utterance.current = u;
    u.onstart = () => { if (token.current === generation) clearTimeout(watchdog.current); };
    u.onend = () => { if (token.current === generation) { clearTimeout(watchdog.current); setStage('answering'); } };
    u.onerror = () => { if (token.current === generation) { clearTimeout(watchdog.current); setStage('ready'); setSpeechError('読み上げを開始できませんでした。もう一度ボタンを押してください。'); } };
    setStage('reading');
    watchdog.current = setTimeout(() => { if (token.current === generation) { cancel(); setStage('ready'); setSpeechError('音声を開始できませんでした。音量を確認し、もう一度お試しください。'); } }, 4000);
    speechSynthesis.speak(u);
  };
  const stop = () => { cancel(); setStage('answering'); setTimeout(() => input.current?.focus(), 0); };
  const a = state?.attempt;
  const answered = Boolean(a?.answered);
  const progress = state ? Math.max(0, state.seen - (a && !a.answered ? 1 : 0)) : 0;
  const submit = async (skip = false) => run(async () => { cancel(); const result = await api<PracticeState>(`/attempts/${a!.id}/answer`, { method: 'POST', body: { answer, skip } }); setState(result); refresh(); });
  return <>
    <div className="stats-grid"><Stat label="登録している問題" value={stats?.total} unit="問" icon="book" /><Stat label="今日の解答" value={stats?.today} unit="問" icon="headphones" /><Stat label="これまでの正解率" value={stats ? stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0 : undefined} unit="%" icon="check" /></div>
    <div className="practice-layout">
      <section className="card practice-card" aria-label="クイズの練習">
        <div className="card-top"><span className="section-label"><span className="status-dot" />全問題から出題</span><span className="pill">{state?.round ? `${state.round}巡目` : '準備中'}</span></div>
        {error && <ErrorBox error={error} retry={() => void load()} />}
        {!state ? !error && <Loading /> : !state.total ? <Empty title="最初の問題を登録しよう"><p>CSVの取り込みや手入力で、<br />あなただけの問題集を作れます。</p><button className="button primary" onClick={onQuestions}><Icon name="plus" />問題を登録する</button></Empty> : !a ? <Empty title="一巡おつかれさまでした"><button className="button primary" disabled={busy} onClick={() => void run(async () => update(await api('/practice/next', { method: 'POST', body: { newRound: true } })))}>次の一巡を始める</button></Empty> : <>
          <div className="question-meta"><span>QUESTION {String(state.seen).padStart(2, '0')}</span><span>{a.category || 'クイズ'}</span></div>
          {answered ? <div className="result" aria-live="polite">
            <div className={`result-badge ${a.skipped ? 'skipped' : a.correct ? 'correct' : 'incorrect'}`}><Icon name={a.skipped ? 'arrow' : a.correct ? 'check' : 'close'} size={26} />{a.skipped ? '答えを確認しました' : a.correct ? '正解です！' : '次につなげよう'}{a.overridden && <small>正解扱いに変更済み</small>}</div>
            <p className="revealed-question">{a.text}</p><div className="answer-reveal"><span className="eyebrow">ANSWER</span><h2>{a.answer}</h2>{!!a.aliases?.length && <p>別解：{a.aliases.join(' ／ ')}</p>}</div>
            {!a.skipped && <p className="your-answer">あなたの答え：<strong>{a.submittedAnswer}</strong></p>}
            {a.note && <p className="question-note">{a.note}</p>}{a.source && <p className="source">出典・メモ：{a.source}</p>}
            <div className="result-actions"><button className={`button secondary ${a.favorite ? 'is-favorite' : ''}`} disabled={busy} onClick={() => void run(async () => { await api(`/favorites/${a.questionId}`, { method: 'PUT', body: { favorite: !a.favorite } }); setState({ ...state, attempt: { ...a, favorite: !a.favorite } }); refresh(); })}><Icon name="star" fill={a.favorite} />{a.favorite ? 'お気に入り済み' : 'お気に入りに追加'}</button>{!a.correct && !a.skipped && <button className="text-button" disabled={busy} onClick={() => void run(async () => { setState(await api(`/attempts/${a.id}/override`, { method: 'POST', body: {} })); refresh(); })}>正解扱いに変更</button>}</div>
            {state.completed && <div className="round-complete"><strong>すべての問題を一巡しました。</strong><span>よく頑張りました。次の一巡も、自分のペースで。</span></div>}
            <button className="button primary wide" disabled={busy} onClick={() => void run(async () => { cancel(); update(await api('/practice/next', { method: 'POST', body: { newRound: state.completed } })); refresh(); })}>{busy ? '準備しています…' : state.completed ? '次の一巡を始める' : '次の問題へ'}<Icon name="arrow" /></button>
          </div> : <>
            <div className={`listening-area ${stage === 'reading' ? 'is-reading' : ''}`}>
              <div className="sound-orbit"><div className="sound-disc">{stage === 'reading' ? <div className="wave" aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <i key={n} />)}</div> : <Icon name="headphones" size={40} />}</div></div>
              <h2>{stage === 'reading' ? '問題を読み上げています' : stage === 'answering' ? '答えを入力しましょう' : '耳をすまして、準備はいい？'}</h2><p>{stage === 'reading' ? 'わかったところで「解答する」を押してください。' : stage === 'answering' ? 'キーボードのマイクを使えば、声でも入力できます。' : 'ボタンを押すと、問題の読み上げが始まります。'}</p>
              {(settings.showQuestion || stage === 'answering' && speechError === 'text') && <p className="visible-question">{a.text}</p>}
            </div>
            {speechError && speechError !== 'text' && <p className="notice" role="status">{speechError}</p>}
            {stage === 'ready' && <><button className="button primary start-button" disabled={busy} onClick={start}><Icon name="play" size={22} />読み上げを始める</button><button className="text-button text-mode" onClick={() => { setSpeechError('text'); setStage('answering'); setTimeout(() => input.current?.focus(), 0); }}>文字を見て回答する</button></>}
            {stage === 'reading' && <button className="button stop-button" onClick={stop}><Icon name="stop" size={23} />解答する<span>読み上げを停止</span></button>}
            {stage === 'answering' && <form className="answer-form" onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="answer">あなたの答え</label><div className="answer-input-row"><input ref={input} id="answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="答えを入力" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={500} enterKeyHint="done" disabled={busy} /><button className="button primary" type="submit" disabled={busy || !answer.trim()}>判定する<Icon name="arrow" size={18} /></button></div><div className="answer-options"><button className="text-button" type="button" disabled={busy} onClick={start}><Icon name="volume" size={16} />もう一度聴く</button><button className="text-button" type="button" disabled={busy} onClick={() => void submit(true)}>わからない・正解を見る</button></div></form>}
          </>}
          <div className="round-progress"><div><span>今回の進み具合</span><strong>{progress}<span> / {state.total} 問</span></strong></div><progress value={progress} max={state.total || 1} aria-label="今回の進み具合" /><small>一巡するまで、同じ問題は出題されません。</small></div>
        </>}
      </section>
      <aside className="practice-aside"><div className="tip-card"><span className="eyebrow">HOW TO PRACTICE</span><h3>聴くことから、はじめよう。</h3><ol><li><span>01</span><div><strong>問題を聴く</strong><p>問題文は隠れたまま。<br />まずは耳で考えてみよう。</p></div></li><li><span>02</span><div><strong>わかったら、ストップ</strong><p>「解答する」で読み上げを止め、<br />答えを入力します。</p></div></li><li><span>03</span><div><strong>気になる一問を残す</strong><p>判定後にお気に入りへ。<br />あとから何度でも見返せます。</p></div></li></ol></div><div className="memo-card"><Icon name="star" size={22} /><p>すぐに答えが出なくても大丈夫。<br />考えた時間も、学びのひとつ。</p></div></aside>
    </div>
  </>;
}
function Stat({ label, value, unit, icon }: { label: string; value?: number; unit: string; icon: string }) {
  return <div className="stat-card"><div><span>{label}</span><strong>{value === undefined ? '—' : value.toLocaleString()}<small>{unit}</small></strong></div><span className="stat-icon"><Icon name={icon} size={22} /></span></div>;
}

function Library({ favoriteOnly, refresh }: { favoriteOnly: boolean; refresh: () => void }) {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const reload = () => { setVersion(v => v + 1); refresh(); };
  useEffect(() => {
    const generation = ++request.current;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      api<{ questions: QuestionRow[]; total: number }>(`/questions?page=${page}&search=${encodeURIComponent(search)}&favorite=${favoriteOnly ? 1 : 0}`)
        .then(data => { if (generation === request.current) { setRows(data.questions); setTotal(data.total); } })
        .catch(e => { if (generation === request.current) setError(e.message); })
        .finally(() => { if (generation === request.current) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); request.current++; };
  }, [page, search, favoriteOnly, version]);
  const toggle = async (q: QuestionRow) => {
    setBusy(true); setError('');
    try { await api(`/favorites/${q.id}`, { method: 'PUT', body: { favorite: !q.favorite } }); reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    <div className="library-toolbar"><label className="search-field"><Icon name="search" /><input aria-label="問題を検索" placeholder="問題文・正解・分野・IDで検索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>{!favoriteOnly && <div className="toolbar-actions"><button className="button secondary" onClick={() => setImporting(true)}><Icon name="upload" />CSV取り込み</button><button className="button primary" onClick={() => setEditing('new')}><Icon name="plus" />問題を追加</button></div>}</div>
    {error && <ErrorBox error={error} retry={() => setVersion(v => v + 1)} />}
    <section className="card library-card"><div className="list-heading"><h2>{favoriteOnly ? 'お気に入りの問題' : 'すべての問題'}<span>{total.toLocaleString()} 問</span></h2><span className="muted">{favoriteOnly ? '見返して、知識を定着させよう' : '20問ずつ表示'}</span></div>
      {loading ? <Loading /> : !rows.length ? <Empty icon={favoriteOnly ? 'star' : 'book'} title={search ? '一致する問題がありません' : favoriteOnly ? 'お気に入りはまだありません' : '自分だけの問題集を作ろう'}><p>{favoriteOnly ? '練習の判定後や問題一覧の星マークから追加できます。' : '手入力で追加するか、CSVを取り込んで始めましょう。'}</p>{!favoriteOnly && !search && <button className="button secondary" onClick={() => setImporting(true)}><Icon name="upload" />例題・CSVテンプレートを見る</button>}</Empty> : <div className="question-list">{rows.map(q => <article className="question-row" key={q.id}><button className={`favorite-toggle ${q.favorite ? 'selected' : ''}`} aria-label={q.favorite ? 'お気に入りを解除' : 'お気に入りに追加'} aria-pressed={q.favorite} disabled={busy} onClick={() => void toggle(q)}><Icon name="star" fill={q.favorite} /></button><div className="question-row-body"><div className="row-meta"><span>{q.category || '未分類'}</span><small>{q.id}</small></div><h3>{q.text}</h3><p><span>正解</span>{q.answer}</p>{q.note && <details><summary>メモ・別解を見る</summary><p>{q.note}</p>{!!q.aliases.length && <p>別解：{q.aliases.join(' ／ ')}</p>}{q.source && <p>出典：{q.source}</p>}</details>}{!q.note && (!!q.aliases.length || q.source) && <p className="row-extra">{q.aliases.length ? `別解：${q.aliases.join(' ／ ')}` : ''}{q.source ? `　出典：${q.source}` : ''}</p>}</div><button className="icon-button" aria-label={`${q.id}を編集`} onClick={() => setEditing(q)}><Icon name="edit" size={19} /></button></article>)}</div>}
      <Pager page={page} total={total} onChange={setPage} />
    </section>
    {editing && <QuestionEditor question={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    {importing && <ImportDialog onClose={() => setImporting(false)} onSaved={() => { setImporting(false); setPage(1); reload(); }} />}
  </>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialog.current; d?.showModal(); return () => { d?.close(); }; }, []);
  return <dialog ref={dialog} className="modal" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="閉じる" onClick={onClose}><Icon name="close" /></button></header>{children}</div></dialog>;
}
function QuestionEditor({ question, onClose, onSaved }: { question: Question | null; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState<Question>(question ?? { id: `q-${crypto.randomUUID().slice(0, 8)}`, text: '', answer: '', aliases: [], reading: '', category: '', source: '', note: '' });
  const [aliases, setAliases] = useState(question?.aliases.join('\n') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key: keyof Question, value: string) => setQ({ ...q, [key]: value });
  return <Modal title={question ? '問題を編集' : '新しい問題を追加'} subtitle="別解と読み上げ用の文章は、必要に応じて登録できます。" onClose={() => { if (!busy) onClose(); }}><form className="editor-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(question ? `/questions/${encodeURIComponent(q.id)}` : '/questions', { method: question ? 'PUT' : 'POST', body: { ...q, aliases: aliases.split('\n').map(s => s.trim()).filter(Boolean) } }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    {error && <ErrorBox error={error} />}
    <label>問題ID <span className="required">必須</span><input required maxLength={100} value={q.id} disabled={!!question || busy} onChange={e => change('id', e.target.value)} /><small>CSVでの再取り込みにも使う固定IDです。</small></label>
    <label>問題文 <span className="required">必須</span><textarea required maxLength={4000} rows={3} value={q.text} onChange={e => change('text', e.target.value)} placeholder="例：日本で最も高い山は何でしょう？" /></label>
    <div className="form-columns"><label>正解 <span className="required">必須</span><input required maxLength={300} value={q.answer} onChange={e => change('answer', e.target.value)} placeholder="例：富士山" /></label><label>分野<input maxLength={100} value={q.category} onChange={e => change('category', e.target.value)} placeholder="例：地理" /></label></div>
    <label>正解として認める別表記<textarea rows={2} value={aliases} onChange={e => setAliases(e.target.value)} placeholder={'ふじさん\nフジサン'} /><small>1行に1つずつ。ひらがな・カタカナの違いは自動では吸収しません。</small></label>
    <details className="advanced"><summary>読み上げ・出典・メモを設定</summary><label>読み上げ用の問題文<textarea rows={3} maxLength={4000} value={q.reading} onChange={e => change('reading', e.target.value)} /><small>空欄の場合は、通常の問題文を読み上げます。</small></label><label>出典<input maxLength={1000} value={q.source} onChange={e => change('source', e.target.value)} /></label><label>メモ・解説<textarea rows={3} maxLength={4000} value={q.note} onChange={e => change('note', e.target.value)} /></label></details>
    <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '保存しています…' : '保存する'}</button></div>
  </form></Modal>;
}

function ImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ existing: string[]; added: number; updated: number } | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const prepare = async (items: Question[]) => {
    setBusy(true); setPreview(null); setConfirmed(false);
    try { setPreview(await api('/import/preview', { method: 'POST', body: items })); }
    catch (e) { setErrors([(e as Error).message]); } finally { setBusy(false); }
  };
  return <Modal title="CSVから問題を取り込む" subtitle="1回500問まで。文字コードはUTF-8で保存してください。" onClose={() => { if (!busy) onClose(); }}>
    <div className="import-help"><p><strong>まずはテンプレートから。</strong> 別解は「|」で区切ります。取り込み前に内容を確認できます。</p><div className="inline-actions"><button className="text-button" onClick={() => download('quiz-template.csv', questionsCsv(sampleQuestions), 'text/csv;charset=utf-8')}><Icon name="download" size={16} />例題付きテンプレート</button><button className="text-button" disabled={busy} onClick={() => { setFileName('動作確認用の例題（5問）'); setQuestions(sampleQuestions); setErrors([]); void prepare(sampleQuestions); }}>例題5問で試す</button></div></div>
    <label className="file-drop"><Icon name="upload" size={30} /><strong>CSVファイルを選ぶ</strong><span>{fileName || 'タップしてファイルを選択'}</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      setFileName(file.name); setPreview(null); setErrors([]); setQuestions([]); setConfirmed(false);
      if (file.size > 4 * 1024 * 1024) { setErrors(['ファイルは4MB以下に分けてください。']); return; }
      try {
        const result = parseQuestionsCsv(await file.text()); setQuestions(result.questions); setErrors(result.errors);
        if (!result.errors.length) await prepare(result.questions);
      } catch { setErrors(['ファイルを読み込めませんでした。UTF-8のCSVか確認してください。']); }
    }} /></label>
    {!!errors.length && <div className="error" role="alert"><strong>取り込む前に修正してください</strong><ul>{errors.slice(0, 20).map((s, i) => <li key={i}>{s}</li>)}</ul>{errors.length > 20 && <p>ほか{errors.length - 20}件</p>}</div>}
    {busy && !preview && <Loading />}
    {preview && !errors.length && <><div className="import-summary"><span>追加 <strong>{preview.added}</strong> 問</span><span>更新 <strong>{preview.updated}</strong> 問</span></div><div className="preview-table"><table><thead><tr><th>ID</th><th>問題文 / 正解</th><th>処理</th></tr></thead><tbody>{questions.slice(0, 20).map(q => <tr key={q.id}><td>{q.id}</td><td>{q.text}<small>{q.answer}</small></td><td>{preview.existing.includes(q.id) ? '更新' : '追加'}</td></tr>)}</tbody></table></div>{questions.length > 20 && <p className="muted">先頭20問を表示しています。合計{questions.length}問を取り込みます。</p>}{preview.updated > 0 && <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />同じIDの問題を更新することを確認しました。お気に入りと過去の履歴は維持されます。</label>}</>}
    <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>閉じる</button><button className="button primary" disabled={busy || !preview || !!errors.length || preview.updated > 0 && !confirmed} onClick={async () => {
      setBusy(true); try { await api('/import', { method: 'POST', body: questions }); onSaved(); } catch (e) { setErrors([(e as Error).message]); } finally { setBusy(false); }
    }}>{busy ? '処理しています…' : `${questions.length || ''}問を取り込む`}</button></div>
  </Modal>;
}

interface HistoryRow { id: string; question_text: string; answer: string; submitted_answer: string; correct: number; overridden: number; skipped: number; answered_at: string }
function History({ stats }: { stats: Stats | null }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<{ history: HistoryRow[]; total: number }>(`/history?page=${page}`).then(data => { if (active) { setRows(data.history); setTotal(data.total); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, version]);
  return <><div className="stats-grid"><Stat label="これまでの解答" value={stats?.answered} unit="問" icon="book" /><Stat label="正解した回数" value={stats?.correct} unit="問" icon="check" /><Stat label="今日の解答" value={stats?.today} unit="問" icon="headphones" /></div><section className="card"><div className="list-heading"><h2>これまでの練習<span>{total} 件</span></h2></div>{error && <ErrorBox error={error} retry={() => setVersion(v => v + 1)} />}{loading ? <Loading /> : !rows.length ? <Empty icon="history" title="最初の一問を、ここから。"><p>練習すると、回答と正誤がここに記録されます。</p></Empty> : <div className="history-list">{rows.map(r => <article key={r.id} className="history-row"><span className={`history-symbol ${r.skipped ? 'skipped' : r.correct ? 'correct' : 'incorrect'}`} aria-label={r.skipped ? 'スキップ' : r.correct ? '正解' : '不正解'}><Icon name={r.skipped ? 'arrow' : r.correct ? 'check' : 'close'} /></span><div><time>{new Date(r.answered_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><h3>{r.question_text}</h3><p>正解：<strong>{r.answer}</strong><span className="history-submission">{r.skipped ? '正解を確認（正解率の集計対象外）' : `あなたの答え：${r.submitted_answer}`}</span></p>{!!r.overridden && <small>自分で正解扱いに変更</small>}</div></article>)}</div>}<Pager page={page} total={total} onChange={setPage} /></section></>;
}

function Preferences({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(settings); }, [settings]);
  const backup = async (csv: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api<{ questions: Question[] }>('/export');
      const date = new Date().toISOString().slice(0, 10);
      download(`q-practice-${date}.${csv ? 'csv' : 'json'}`, csv ? questionsCsv(data.questions) : JSON.stringify(data, null, 2), csv ? 'text/csv;charset=utf-8' : 'application/json');
      setMessage(csv ? '問題のCSVを書き出しました。再取り込みにも使えます。' : '問題・お気に入り・履歴・進み具合・設定をJSONに書き出しました。');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="settings-grid"><section className="card settings-card"><div className="section-label"><Icon name="volume" />練習の設定</div><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const s = await api<Settings>('/settings', { method: 'PUT', body: draft }); onSave(s); setMessage('設定を保存しました。'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><label className="range-label">読み上げ速度<strong>{draft.rate.toFixed(1)} 倍</strong><input type="range" min="0.5" max="2" step="0.1" value={draft.rate} onChange={e => setDraft({ ...draft, rate: Number(e.target.value) })} /></label><div className="range-markers"><span>ゆっくり</span><span>はやく</span></div><label className="toggle-label"><div><strong>問題文を常に表示</strong><p>オフの場合は、判定後に全文を表示します。</p></div><input type="checkbox" role="switch" checked={draft.showQuestion} onChange={e => setDraft({ ...draft, showQuestion: e.target.checked })} /></label><p className="muted">設定はiPhoneとPCで共有されます。</p><button className="button primary" disabled={busy}>{busy ? '処理しています…' : '設定を保存'}</button></form></section><section className="card settings-card"><div className="section-label"><Icon name="download" />データの書き出し</div><h3>大切な問題を、手元にも。</h3><p className="muted">定期的な書き出しがおすすめです。CSVは問題の再取り込み用、JSONは履歴なども含めたデータの保管用です。</p><div className="export-actions"><button className="button secondary" disabled={busy} onClick={() => void backup(true)}><Icon name="download" />問題をCSVで保存</button><button className="button secondary" disabled={busy} onClick={() => void backup(false)}><Icon name="download" />全データをJSONで保存</button></div><p className="small-note">JSONからの一括復元画面は初版の対象外です。完全な復元用バックアップの作成手順はREADMEに記載しています。</p></section>{error && <ErrorBox error={error} />}{message && <div className="success" role="status"><Icon name="check" />{message}</div>}<section className="card settings-card full-width"><div className="section-label"><Icon name="headphones" />音声入力について</div><p>回答欄をタップし、iPhoneのキーボードにあるマイクから話すと、声で答えを入力できます。文字を確認して「判定する」を押してください。</p><p className="muted">固有名詞の誤変換などで不正解になった場合は、判定後に「正解扱いに変更」できます。アプリ専用の音声回答モードは今後追加する予定です。</p></section></div>;
}

createRoot(document.getElementById('root')!).render(<App />);
