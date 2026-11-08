import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, download } from './api';
import { Icon } from './icons';
import { parseQuestionsCsv, questionsCsv, sampleQuestions } from '../shared/csv';
import type { PracticeState, Question, QuestionRow, Settings, Stats } from '../shared/model';
import { spokenText, type SpeechConfig } from '../shared/speech';
import type { CollectionSummary } from '../shared/collections';
import { practiceLabel, type PracticeOptions } from '../shared/practice';
import { announceQuestion, isNewCorrectResult, playCorrectAnswer } from './speech';
import { Link, useRoute, navigate as go, closeRoute, updateQuery, listPage, type Page } from './router';
import './style.css';

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
  const route = useRoute();
  const page = route.page;
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
  const navigate = (target: Page) => go('/' + target);
  useEffect(() => {
    const viewTitle = route.view && { new: '新しい問題を追加', edit: '問題を編集', import: 'CSV取り込み', collections: '問題集を管理' }[route.view];
    document.title = (viewTitle || pages.find(p => p.id === page)?.label || 'ページが見つかりません') + ' | Quiz Practice';
    if (route.pathname === '/') go('/practice' + route.search, true);
  }, [route.pathname]);
  useEffect(() => { window.speechSynthesis?.cancel(); window.scrollTo(0, 0); }, [page]);
  const current = pages.find(p => p.id === page) ?? { label: 'ページが見つかりません', en: 'PAGE NOT FOUND', icon: 'book' };
  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/practice"><span className="brand-mark">Q<span /></span><span>Quiz Practice</span></Link>

      <nav aria-label="メインナビゲーション">{pages.map(p => <Link href={'/' + p.id} key={p.id} className={`nav-item ${page === p.id ? 'active' : ''}`} aria-current={page === p.id ? 'page' : undefined}><Icon name={p.icon} /><span>{p.label}</span>{p.id === 'favorites' && !!stats?.favorites && <span className="nav-count">{stats.favorites}</span>}</Link>)}</nav>
      <div className="account"><span className="avatar">Y</span><span><small title={email}>{email || '接続を確認しています'}</small></span><Icon name="shield" size={16} /></div>
    </aside>
    <main className="main">
      <div className="content">
        {!(page === 'practice' && route.params.get('play') === '1') && <header className="page-heading"><h1>{current.label}</h1></header>}

        {page === 'not-found' && <Empty title="ページが見つかりません"><Link className="button primary" href="/practice">練習する</Link></Empty>}
        {page === 'practice' && <PracticeEntry settings={settings} stats={stats} refresh={refresh} onQuestions={() => navigate('questions')} />}
        {(page === 'questions' || page === 'favorites') && <Library key={page} favoriteOnly={page === 'favorites'} refresh={refresh} />}
        {page === 'history' && <History stats={stats} />}
        {page === 'settings' && <Preferences settings={settings} onSave={s => { setSettings(s); refresh(); }} />}
        {error && <ErrorBox error={error} retry={() => void load()} />}
      </div>
    </main>
    <nav className="mobile-nav" aria-label="モバイルナビゲーション">{pages.map(p => <Link href={'/' + p.id} key={p.id} className={page === p.id ? 'active' : ''} aria-current={page === p.id ? 'page' : undefined}><Icon name={p.icon} size={21} /><span>{p.id === 'questions' ? '問題' : p.id === 'history' ? '記録' : p.id === 'practice' ? '練習' : p.label}</span></Link>)}</nav>
  </div>;
}

type PracticeProps = { settings: Settings; stats: Stats | null; refresh: () => void; onQuestions: () => void };
function PracticeEntry(props: PracticeProps) {
  const route = useRoute();
  const playing = route.params.get('play') === '1';
  const collection = route.params.get('collection');
  const favoriteOnly = route.params.get('favorite') === '1';
  const [options, setOptions] = useState<PracticeOptions | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setError(''); void api<PracticeOptions>('/practice/options').then(setOptions).catch(e => setError((e as Error).message)); };
  useEffect(() => { if (!playing) { setOptions(null); setChoosing(false); load(); } }, [playing]);
  const href = (name: string | null, favorites = false) => '/practice?play=1' + (favorites ? '&favorite=1' : '') + (name === null ? '' : '&collection=' + encodeURIComponent(name));
  if (playing) return <Practice key={JSON.stringify([collection, favoriteOnly])} {...props} collection={collection} favoriteOnly={favoriteOnly} />;
  return <section className="card practice-picker" aria-label="出題する問題集">
    <h2>出題する問題集</h2>
    {error && <ErrorBox error={error} retry={load} />}


    {!options ? !error && <Loading /> : <>
      {options.last ? <Link className="practice-choice resume-choice" href={href(options.last.collection, options.last.favoriteOnly)}><span><strong>前回（{options.last.favoriteOnly ? 'お気に入り・' : ''}{practiceLabel(options.last.collection)}）の続きから</strong><small>{options.last.progress} / {options.last.total} 問 解答済み</small></span><Icon name="arrow" /></Link> : <div className="practice-choice unavailable"><span><strong>前回の続きから</strong><small>まだ続きの練習はありません</small></span></div>}
      <Link className="practice-choice" href={href(null)}><span><strong>全ての問題集から出題</strong><small>全 {options.total} 問</small></span><Icon name="arrow" /></Link>
      <button className="practice-choice" aria-expanded={choosing} onClick={() => setChoosing(v => !v)}><span><strong>出題する問題集を選ぶ</strong></span><Icon name="book" /></button>
      {choosing && <div className="practice-collections">{options.collections.map(c => c.total ? <Link key={c.name} className="practice-choice" href={href(c.name)}><span><strong>{practiceLabel(c.name)}</strong><small>{c.progress} / {c.total} 問 解答済み</small></span><Icon name="arrow" /></Link> : <div key={c.name} className="practice-choice unavailable"><span><strong>{practiceLabel(c.name)}</strong><small>問題がありません</small></span></div>)}</div>}
      {!options.total && <button className="button primary" onClick={props.onQuestions}>問題を登録する</button>}
    </>}
  </section>;
}
function Practice({ settings, stats, refresh, onQuestions, collection, favoriteOnly }: PracticeProps & { collection: string | null; favoriteOnly: boolean }) {
  const [state, setState] = useState<PracticeState | null>(null);
  const [stage, setStage] = useState<'ready' | 'reading' | 'answering'>('ready');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [speechConfig, setSpeechConfig] = useState<SpeechConfig | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparedId, setPreparedId] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef('');
  const pendingSpeech = useRef<AbortController | null>(null);
  const autoPlay = useRef(true);
  const pendingCorrect = useRef('');
  const [correctSoundError, setCorrectSoundError] = useState(false);
  const [showText, setShowText] = useState(false);
  const pushAudio = useRef<HTMLAudioElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const introCleanup = useRef<(() => void) | undefined>(undefined);
  const stopDelay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const token = useRef(0);
  const cancel = useCallback(() => {
    token.current++; clearTimeout(watchdog.current); clearTimeout(stopDelay.current); stopDelay.current = undefined; introCleanup.current?.(); introCleanup.current = undefined; window.speechSynthesis?.cancel(); utterance.current = null;
    pendingSpeech.current?.abort(); pendingSpeech.current = null;
    if (audio.current) { audio.current.pause(); audio.current.currentTime = 0; }
  }, []);
  const releaseAudio = () => {
    if (audio.current) { audio.current.onended = null; audio.current.onerror = null; audio.current.removeAttribute('src'); audio.current.load(); }
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = '';
  };
  const update = (data: PracticeState) => { setShowText(false); pushAudio.current?.pause(); cancel(); releaseAudio(); autoPlay.current = !data.attempt?.retryRequested; pendingCorrect.current = ''; setCorrectSoundError(false); setPreparedId(''); setPreparing(false); setSpeechError(''); setState(data); setAnswer(''); setStage(data.attempt?.retryRequested ? 'answering' : 'ready'); };
  const load = async () => {
    setError('');
    try {
      let data = await api<PracticeState>('/practice/select', { method: 'POST', body: { collection, favoriteOnly } });
      if (!data.attempt && data.total) data = await api<PracticeState>('/practice/next', { method: 'POST', body: { collection, favoriteOnly } });
      update(data);
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    void load();
    void api<SpeechConfig>('/speech/config').then(setSpeechConfig).catch(e => setSpeechError((e as Error).message));
    return () => { pushAudio.current?.pause(); cancel(); releaseAudio(); };
  }, [cancel]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const start = () => {
    if (!state?.attempt || preparing) return;
    const attempt = state.attempt;
    setSpeechError(''); cancel();
    if (!speechConfig) { setSpeechError('音声設定を取得できません。ページを再読み込みしてください。'); return; }
    if (speechConfig.provider === 'google' && (preparedId !== state.attempt.id || !audio.current)) { setStage('ready'); autoPlay.current = true; void prepareSpeech(); return; }
    const sequence = token.current;
    const readBody = () => {
      if (token.current !== sequence) return;
      if (speechConfig.provider === 'google') {
        if (preparedId !== attempt.id || !audio.current) { setStage('ready'); autoPlay.current = true; void prepareSpeech(); return; }
        const generation = token.current;
        const player = audio.current;
        player.src = audioUrl.current;
        player.playbackRate = settings.rate;
        player.onended = () => { if (token.current === generation) setStage('answering'); };
        player.onerror = () => { if (token.current === generation) { setStage('ready'); setSpeechError('音声を再生できませんでした。ページを再読み込みしてお試しください。'); } };
        setStage('reading');
        void player.play().catch(() => { if (token.current === generation) { setStage('ready'); setSpeechError('自動再生できませんでした。「音声を再生」を押してください。'); } });
        return;
      }
      if (!('speechSynthesis' in window)) { setStage('ready'); setSpeechError('このブラウザでは読み上げを利用できません。「文字を見て回答」から練習できます。'); return; }
      const generation = token.current;
      const text = spokenText(attempt.reading || attempt.text);
      if (!text) { setStage('ready'); setSpeechError('括弧内を除くと読み上げ文が空になります。問題文を確認してください。'); return; }
      const u = new SpeechSynthesisUtterance(text);
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
    audio.current ??= new Audio();
    setStage('reading');
    introCleanup.current = announceQuestion(audio.current, readBody, () => {
      if (token.current === sequence) { cancel(); setStage('ready'); setSpeechError('「問題」の音声を開始できませんでした。「音声を再生」を押してお試しください。'); }
    });
  };
  const prepareSpeech = async () => {
    if (!state?.attempt || preparing) return;
    cancel(); releaseAudio(); setPreparedId(''); setSpeechError(''); setPreparing(true);
    const generation = token.current;
    const controller = new AbortController(); pendingSpeech.current = controller;
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId: state.attempt.id }), signal: controller.signal });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('audio/mpeg')) {
        const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() as { error?: string } : null;
        throw new Error(data?.error || '音声を取得できません。ログインとサーバーの設定を確認してください。');
      }
      const blob = await response.blob();
      if (generation !== token.current) return;
      audioUrl.current = URL.createObjectURL(blob);
      audio.current ??= new Audio();
      audio.current.src = audioUrl.current;
      audio.current.preload = 'auto';
      setPreparedId(state.attempt.id);
    } catch (e) {
      if (generation === token.current) setSpeechError(controller.signal.aborted ? '音声の準備がタイムアウトしました。もう一度お試しください。' : (e as Error).message);
    } finally { clearTimeout(timeout); if (generation === token.current) { setPreparing(false); pendingSpeech.current = null; } }
  };
  useEffect(() => {
    if (!state?.attempt || state.attempt.answered || speechConfig?.provider !== 'google') return;
    void prepareSpeech();
    return () => { cancel(); releaseAudio(); };
  }, [state?.attempt?.id, state?.attempt?.answered, speechConfig?.provider, speechConfig?.voice]);
  useEffect(() => {
    if (!state?.attempt || state.attempt.answered || !speechConfig || !autoPlay.current || preparing) return;
    if (speechConfig.provider === 'google' && preparedId !== state.attempt.id) return;
    autoPlay.current = false;
    start();
  }, [state?.attempt?.id, state?.attempt?.answered, speechConfig, preparedId, preparing]);
  const playCorrectSound = () => {
    cancel(); releaseAudio(); setCorrectSoundError(false);
    const generation = token.current;
    audio.current ??= new Audio();
    playCorrectAnswer(audio.current, () => { if (token.current === generation) setCorrectSoundError(true); });
  };
  // Run after the question-audio cleanup caused by the answer state change.
  useEffect(() => {
    if (pendingCorrect.current !== state?.attempt?.id || !state.attempt.answered || !state.attempt.correct || state.attempt.skipped) return;
    pendingCorrect.current = '';
    playCorrectSound();
  }, [state?.attempt?.id, state?.attempt?.answered, state?.attempt?.correct]);
  const unlockAudio = () => {
    cancel();
    // Unlock during the tap, before fetching a question or an answer result.
    releaseAudio(); setPreparedId('');
    const silent = Uint8Array.from(atob('UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA=='), c => c.charCodeAt(0));
    audioUrl.current = URL.createObjectURL(new Blob([silent], { type: 'audio/wav' }));
    audio.current ??= new Audio(); audio.current.src = audioUrl.current;
    void audio.current.play().catch(() => {});
  };
  const next = (newRound: boolean) => {
    unlockAudio();
    void run(async () => { const data = await api<PracticeState>('/practice/next', { method: 'POST', body: { newRound, collection, favoriteOnly } }); update(data.total ? data : { ...data, attempt: null }); refresh(); });
  };
  const stop = () => {
    pushAudio.current ??= new Audio('/audio/push.mp3');
    pushAudio.current.currentTime = 0; pushAudio.current.playbackRate = 1;
    void pushAudio.current.play().catch(() => {});
    autoPlay.current = false;
    clearTimeout(stopDelay.current);
    stopDelay.current = setTimeout(() => { stopDelay.current = undefined; cancel(); }, 300);
    setStage('answering'); setTimeout(() => input.current?.focus(), 0);
  };
  const a = state?.attempt;
  const answered = Boolean(a?.answered);
  const progress = state ? Math.max(0, state.seen - (a && !a.answered ? 1 : 0)) : 0;
  const receiveResult = (result: PracticeState) => {
    pendingCorrect.current = isNewCorrectResult(a, result.attempt) ? result.attempt!.id : '';
    setState(result);
  };
  const submit = async (skip = false) => run(async () => { unlockAudio(); const result = await api<PracticeState>(`/attempts/${a!.id}/answer`, { method: 'POST', body: { answer, skip } }); receiveResult(result);
    if (result.attempt?.retryRequested) {
      setAnswer(''); setStage('answering');
      if (window.speechSynthesis) { const prompt = new SpeechSynthesisUtterance('もう一回'); prompt.lang = 'ja-JP'; utterance.current = prompt; window.speechSynthesis.speak(prompt); }
      setTimeout(() => input.current?.focus(), 0);
    }
    refresh(); });
  return <div className="practice-session">

    <div className="practice-layout">
      <section className="card practice-card" aria-label="クイズの練習">
        {!state ? !error && <Loading /> : !state.total && !a?.answered ? <Empty title={favoriteOnly ? "お気に入りの問題がありません" : "出題できる問題がありません"}><button className="button primary" onClick={onQuestions}>問題を管理する</button></Empty> : !a ? <Empty title="一巡完了"><button className="button primary" disabled={busy} onClick={() => next(true)}>次の一巡を始める</button></Empty> : <>
          {answered ? <div className="result" aria-live="polite">
            <div className={`result-badge ${a.skipped ? 'skipped' : a.correct ? 'correct' : 'incorrect'}`}><Icon name={a.skipped ? 'arrow' : a.correct ? 'check' : 'close'} size={26} />{a.skipped ? '答えを確認しました' : a.correct ? '正解です！' : '不正解です'}{a.overridden && <small>正解扱いに変更済み</small>}</div>
            {correctSoundError && <p className="notice" role="status">正解音を再生できませんでした。<button className="text-button" onClick={playCorrectSound}>正解音を再生</button></p>}
            <p className="revealed-question">{a.text}</p><div className="answer-reveal"><span className="eyebrow">ANSWER</span><h2>{a.answer}</h2>{!!a.aliases?.length && <p>別解：{a.aliases.join(' ／ ')}</p>}</div>
            {!a.skipped && <p className="your-answer">あなたの答え：<strong>{a.submittedAnswer}</strong></p>}
            {a.note && <p className="question-note">{a.note}</p>}{a.source && <p className="source">出典・メモ：{a.source}</p>}
            <div className="result-actions"><button className={`button secondary ${a.favorite ? 'is-favorite' : ''}`} disabled={busy} onClick={() => void run(async () => { await api(`/favorites/${a.questionId}`, { method: 'PUT', body: { favorite: !a.favorite } }); setState({ ...state, attempt: { ...a, favorite: !a.favorite } }); refresh(); })}><Icon name="star" fill={a.favorite} />{a.favorite ? 'お気に入り済み' : 'お気に入りに追加'}</button>{!a.correct && !a.skipped && <button className="text-button" disabled={busy} onClick={() => void run(async () => { unlockAudio(); receiveResult(await api(`/attempts/${a.id}/override`, { method: 'POST', body: {} })); refresh(); })}>正解扱いに変更</button>}</div>
            <div className="visibility-actions">{a.hidden ? <p role="status"><span className="hidden-badge">非表示</span> 練習では出題されません。問題を管理から再表示できます。</p> : <button className="button secondary" disabled={busy} onClick={() => void run(async () => { await api('/questions/' + encodeURIComponent(a.questionId) + '/visibility', { method: 'PUT', body: { hidden: true } }); const query = new URLSearchParams(); if (collection !== null) query.set('collection', collection); if (favoriteOnly) query.set('favorite', '1'); const latest = await api<PracticeState>('/practice' + (query.size ? '?' + query : '')); setState({ ...latest, attempt: { ...a, hidden: true } }); refresh(); })}>この問題を再表示しない</button>}</div>
            {state.completed && state.total > 0 && <div className="round-complete"><strong>すべての問題を一巡しました。</strong></div>}
            <button className="button primary wide" disabled={busy} onClick={() => next(state.completed)}>{busy ? '準備しています…' : !state.total ? '出題できる問題を確認する' : state.completed ? '次の一巡を始める' : '次の問題へ'}<Icon name="arrow" /></button>
          </div> : <>
            {stage === 'reading' && <div className="buzzer-area"><button className="buzzer-button" onClick={stop} aria-label="解答する：読み上げを停止"><span className="buzzer-cap" aria-hidden="true" /></button></div>}

            {(settings.showQuestion || showText || speechError === 'text') && <p className="visible-question practice-question">{a.text}</p>}
            {!settings.showQuestion && !showText && speechError !== 'text' && <button className="button secondary question-text-toggle" onClick={() => setShowText(true)}>問題文を表示する</button>}
            {speechError && speechError !== 'text' && <p className="notice" role="status">{speechError}</p>}
            {stage === 'ready' && <>
              {preparing && <p className="audio-loading" role="status"><span className="spinner" />音声を読み込んでいます…</p>}
              {speechError && !preparing && <button className="button primary start-button" disabled={busy || !speechConfig} onClick={speechConfig?.provider === 'google' && preparedId !== a.id ? () => { autoPlay.current = true; void prepareSpeech(); } : start}><Icon name="play" size={22} />{speechConfig?.provider === 'google' && preparedId !== a.id ? '音声の準備を再試行' : '音声を再生'}</button>}
              <button className="text-button text-mode" onClick={() => { autoPlay.current = false; cancel(); setPreparing(false); setSpeechError('text'); setStage('answering'); setTimeout(() => input.current?.focus(), 0); }}>文字を見て回答する</button>
            </>}

            {a.retryRequested && <p className="notice" role="status">もう一回</p>}
            {stage === 'answering' && <form className="answer-form" onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="answer">あなたの答え</label><div className="answer-input-row"><input ref={input} id="answer" value={answer} onChange={e => setAnswer(e.target.value)} placeholder="答えを入力" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={500} enterKeyHint="done" disabled={busy} /><button className="button primary" type="submit" disabled={busy || !answer.trim()}>判定する<Icon name="arrow" size={18} /></button></div><div className="answer-options"><button className="button secondary" type="button" disabled={busy || preparing} onClick={start}><Icon name="volume" size={20} />もう一度聴く</button><button className="button secondary" type="button" disabled={busy} onClick={() => void submit(true)}>わからない・正解を見る</button></div></form>}
          </>}
          <div className="question-meta"><span>QUESTION {a.hidden ? '—' : String(state.seen).padStart(2, '0')}</span><span>{[a.collection, a.majorCategory, a.minorCategory].filter(Boolean).join(' / ') || a.category || 'クイズ'}</span></div>
          <div className="round-progress"><div><span>今回の進み具合</span><strong>{progress}<span> / {state.total} 問</span></strong></div><progress value={progress} max={state.total || 1} aria-label="今回の進み具合" /></div>
        </>}
        <div className="practice-footer">
          <div className="card-top"><span className="section-label"><span className="status-dot" />{favoriteOnly ? 'お気に入り（' + practiceLabel(collection) + '）' : practiceLabel(collection)}から出題</span><span className="pill">{state?.round ? `${state.round}巡目` : '準備中'}</span></div>
          <Link className="text-button picker-back" href={favoriteOnly ? "/favorites" : "/practice"}>← {favoriteOnly ? "お気に入りへ戻る" : "問題集を選び直す"}</Link>
        </div>
        {error && <ErrorBox error={error} retry={() => void load()} />}
      </section>

    </div>
    <div className="stats-grid practice-stats"><Stat label="登録している問題" value={stats?.total} unit="問" icon="book" /><Stat label="今日の解答" value={stats?.today} unit="問" icon="headphones" /><Stat label="これまでの正解率" value={stats ? stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0 : undefined} unit="%" icon="check" /></div>
  </div>;
}
function Stat({ label, value, unit, icon }: { label: string; value?: number; unit: string; icon: string }) {
  return <div className="stat-card"><div><span>{label}</span><strong>{value === undefined ? '—' : value.toLocaleString()}<small>{unit}</small></strong></div><span className="stat-icon"><Icon name={icon} size={22} /></span></div>;
}

function AnswerDetails({ answer, aliases, retryAliases = [], note = '', source = '', submittedAnswer }: { answer: string; aliases: string[]; retryAliases?: string[]; note?: string; source?: string; submittedAnswer?: string }) {
  return <details className="answer-details"><summary>答えを見る</summary><p className="answer-correct"><span>正解：</span><strong>{answer}</strong></p>{!!aliases.length && <p>別解：{aliases.join(' ／ ')}</p>}{submittedAnswer !== undefined && <p className="answer-submission">あなたの答え：{submittedAnswer}</p>}{!!retryAliases.length && <p>もう一回：{retryAliases.join(' ／ ')}</p>}{note && <p>メモ：{note}</p>}{source && <p>出典：{source}</p>}</details>;
}

function Library({ favoriteOnly, refresh }: { favoriteOnly: boolean; refresh: () => void }) {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [total, setTotal] = useState(0);
  const route = useRoute();
  const search = route.params.get('search') ?? '';
  const collection = route.params.get('collection') ?? '*';
  const setSearch = (value: string) => updateQuery({ search: value, page: null }, true);
  const setCollection = (value: string) => updateQuery({ collection: value === '*' ? null : value, page: null });
  const [collections, setCollections] = useState<{ name: string; total: number }[]>([]);
  const managingCollections = route.view === 'collections';
  const base = favoriteOnly ? '/favorites' : '/questions';
  const parent = base + route.search;
  const open = (path: string) => go(path + route.search, false, true);
  const close = () => closeRoute(parent);
  const page = listPage(route.params);
  const setPage = (value: number) => updateQuery({ page: value === 1 ? null : String(value) });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const importing = route.view === 'import';
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const reload = () => { setVersion(v => v + 1); refresh(); };
  useEffect(() => {
    let active = true;
    api<{ collections: { name: string; total: number }[] }>('/collections')
      .then(d => { if (active) setCollections(d.collections); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [version]);
  useEffect(() => {
    const generation = ++request.current;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      api<{ questions: QuestionRow[]; total: number }>(`/questions?page=${page}&search=${encodeURIComponent(search)}&favorite=${favoriteOnly ? 1 : 0}${collection === '*' ? '' : `&collection=${encodeURIComponent(collection)}`}`)
        .then(data => { if (generation === request.current) { setRows(data.questions); setTotal(data.total); } })
        .catch(e => { if (generation === request.current) setError(e.message); })
        .finally(() => { if (generation === request.current) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); request.current++; };
  }, [page, search, favoriteOnly, version, collection]);
  const toggle = async (q: QuestionRow) => {
    setBusy(true); setError('');
    try { await api(`/favorites/${q.id}`, { method: 'PUT', body: { favorite: !q.favorite } }); reload(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const toggleVisibility = async (q: QuestionRow) => {
    setBusy(true); setError('');
    try {
      const { hidden } = await api<{ hidden: boolean }>('/questions/' + encodeURIComponent(q.id) + '/visibility', { method: 'PUT', body: { hidden: !q.hidden } });
      setRows(current => current.map(row => row.id === q.id ? { ...row, hidden } : row));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <>
    {favoriteOnly && <div className="favorite-practice-start"><Link className="button primary" href={"/practice?play=1&favorite=1" + (collection === "*" ? "" : "&collection=" + encodeURIComponent(collection))}><Icon name="play" />ランダムに出題する</Link></div>}
    <div className="collection-toolbar"><label>問題集<select aria-label="問題集で絞り込み" value={collection} onChange={e => { setCollection(e.target.value); }}><option value="*">すべての問題集</option>{collections.map(c => <option key={c.name} value={c.name}>{c.name || '未分類'}（{c.total}問）</option>)}</select></label>{!favoriteOnly && <button className="button secondary" onClick={() => open('/questions/collections')}><Icon name="book" />問題集を管理</button>}</div>
    <div className="library-toolbar"><label className="search-field"><Icon name="search" /><input aria-label="問題を検索" placeholder="問題文・正解・ジャンル・IDで検索" value={search} onChange={e => { setSearch(e.target.value); }} /></label>{!favoriteOnly && <div className="toolbar-actions"><button className="button secondary" onClick={() => open('/questions/import')}><Icon name="upload" />CSV取り込み</button><button className="button primary" onClick={() => open('/questions/new')}><Icon name="plus" />問題を追加</button></div>}</div>
    {error && <ErrorBox error={error} retry={() => setVersion(v => v + 1)} />}
    <section className="card library-card"><div className="list-heading"><h2>{favoriteOnly ? 'お気に入りの問題' : 'すべての問題'}<span>{total.toLocaleString()} 問</span></h2></div>
      {loading ? <Loading /> : !rows.length ? <Empty icon={favoriteOnly ? 'star' : 'book'} title={search ? '一致する問題がありません' : favoriteOnly ? 'お気に入りはまだありません' : '問題がありません'}>{!favoriteOnly && !search && <button className="button secondary" onClick={() => open('/questions/import')}><Icon name="upload" />例題・CSVテンプレートを見る</button>}</Empty> : <div className="question-list">{rows.map(q => <article className="question-row" key={q.id}><button className={`favorite-toggle ${q.favorite ? 'selected' : ''}`} aria-label={q.favorite ? 'お気に入りを解除' : 'お気に入りに追加'} aria-pressed={q.favorite} disabled={busy} onClick={() => void toggle(q)}><Icon name="star" fill={q.favorite} /></button><div className="question-row-body"><div className="row-meta"><span>{[q.collection, q.majorCategory, q.minorCategory].filter(Boolean).join(' / ') || q.category || '未分類'}</span><small>{q.id}</small>{q.hidden && <span className="hidden-badge">非表示</span>}</div><h3>{q.text}</h3><AnswerDetails answer={q.answer} aliases={q.aliases} retryAliases={q.retryAliases} note={q.note} source={q.source} /></div><div className="question-row-actions">{!favoriteOnly && <button className={`icon-button visibility-toggle ${q.hidden ? 'is-hidden' : ''}`} aria-label={q.hidden ? '再表示する（練習の出題対象に戻す）' : '練習で出題しない'} title={q.hidden ? '再表示する（練習の出題対象に戻す）' : '練習で出題しない'} aria-pressed={q.hidden} disabled={busy} onClick={() => void toggleVisibility(q)}><Icon name="mute" size={19} /></button>}<button className="icon-button" aria-label={`${q.id}を編集`} onClick={() => open(base + '/' + encodeURIComponent(q.id) + '/edit')}><Icon name="edit" size={19} /></button></div></article>)}</div>}
      <Pager page={page} total={total} onChange={setPage} />
    </section>
    {managingCollections && <CollectionsDialog onClose={close} onChanged={() => { updateQuery({ collection: null, page: null }, true); reload(); }} />}
    {(route.view === 'new' || route.view === 'edit') && <RoutedQuestionEditor key={route.id ?? 'new'} id={route.id} onClose={close} onSaved={() => { reload(); close(); }} />}
    {importing && <ImportDialog onClose={close} onSaved={() => { reload(); close(); }} />}
  </>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialog.current; d?.showModal(); return () => { d?.close(); }; }, []);
  return <dialog ref={dialog} className="modal" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-inner"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="閉じる" onClick={onClose}><Icon name="close" /></button></header>{children}</div></dialog>;
}

function CollectionsDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selection, setSelection] = useState<{ kind: 'rename' | 'delete'; item: CollectionSummary } | null>(null);
  const [name, setName] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { const data = await api<{ collections: CollectionSummary[] }>('/collections'); setCollections(data.collections); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const backup = async (item: CollectionSummary) => {
    setBusy(true); setError('');
    try {
      const data = await api<{ questions: Question[] }>('/collections/export?name=' + encodeURIComponent(item.name));
      download('quiz-collection.csv', questionsCsv(data.questions), 'text/csv;charset=utf-8');
      setMessage('問題集のCSVを保存しました。再取り込みにも使えます。');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const changed = async (text: string) => { setSelection(null); setName(''); setConfirmation(''); setMessage(text); onChanged(); await load(); };
  return <Modal title={selection?.kind === 'rename' ? '問題集の名前を変更' : selection?.kind === 'delete' ? '問題集を削除' : '問題集を管理'} onClose={() => { if (!busy) onClose(); }}>
    {error && <ErrorBox error={error} retry={() => void load()} />}
    {message && <p className="success" role="status">{message}</p>}
    {!selection ? <>
      <form className="collection-create" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('');
        try { await api('/collections', { method: 'POST', body: { name } }); await changed('問題集を作成しました。'); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}><label>新しい問題集名<input required maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><button className="button primary" disabled={busy || !name.trim()}>作成する</button></form>
      {loading ? <Loading /> : <div className="collection-list">{collections.map(item => <article key={item.name} className="collection-row"><div><h3>{item.name || '未分類'}</h3><span>{item.total.toLocaleString()} 問</span></div>{item.name ? <div className="collection-actions"><button className="button small secondary" disabled={busy} onClick={() => void backup(item)}>CSVを保存</button><button className="button small secondary" disabled={busy} onClick={() => { setSelection({ kind: 'rename', item }); setName(item.name); setError(''); setMessage(''); }}>名前を変更</button><button className="button small danger-outline" disabled={busy} onClick={() => { setSelection({ kind: 'delete', item }); setConfirmation(''); setError(''); setMessage(''); }}>削除</button></div> : <span className="muted">未分類</span>}</article>)}</div>}
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>閉じる</button></div>
    </> : selection.kind === 'rename' ? <form className="editor-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await api('/collections', { method: 'PUT', body: { name: selection.item.name, newName: name } }); await changed('問題集名を変更しました。'); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><p>「{selection.item.name}」・{selection.item.total}問</p><label>新しい問題集名<input required maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} autoFocus /></label><p className="small-note">問題ID・お気に入り・解答履歴は維持されます。再取り込み用のCSVは名前変更後に保存してください。</p><div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setSelection(null); setName(''); setError(''); }}>戻る</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? '保存しています…' : '名前を変更する'}</button></div></form> : <form className="editor-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { await api('/collections', { method: 'DELETE', body: { name: selection.item.name, confirmation, total: selection.item.total } }); await changed('問題集と所属する問題を削除しました。'); }
      catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}><div className="delete-impact"><strong>「{selection.item.name}」の{selection.item.total.toLocaleString()}問を削除します。</strong><p>問題集と所属問題を一覧・出題から外し、お気に入りも解除します。解答中の所属問題は中止します。過去の解答履歴と成績は残ります。</p><p>必要な問題は削除前にCSVを保存してください。保存したCSVを再取り込みすると問題を戻せます。</p><button type="button" className="button secondary" disabled={busy} onClick={() => void backup(selection.item)}>削除前にCSVを保存</button></div><label>確認のため「{selection.item.name}」と入力<input value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} autoComplete="off" autoFocus /></label><div className="modal-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => { setSelection(null); setName(''); setError(''); }}>戻る</button><button className="button danger" disabled={busy || confirmation !== selection.item.name}>{busy ? '削除しています…' : '問題集と所属問題を削除'}</button></div></form>}
  </Modal>;
}

function RoutedQuestionEditor({ id, onClose, onSaved }: { id?: string; onClose: () => void; onSaved: () => void }) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<Question>('/questions/' + encodeURIComponent(id)).then(q => { if (active) setQuestion(q); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);
  if (id && !question) return <Modal title="問題を編集" onClose={onClose}>{error ? <ErrorBox error={error} /> : <Loading />}</Modal>;
  return <QuestionEditor question={question} onClose={onClose} onSaved={onSaved} />;
}

function QuestionEditor({ question, onClose, onSaved }: { question: Question | null; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState<Question>(question ?? { id: `q-${crypto.randomUUID().slice(0, 8)}`, text: '', answer: '', aliases: [], retryAliases: [], collection: '', majorCategory: '', minorCategory: '', reading: '', category: '', source: '', note: '' });
  const [aliases, setAliases] = useState(question?.aliases.join('\n') ?? '');
  const [retryAliases, setRetryAliases] = useState(question?.retryAliases.join('\n') ?? '');
  const [collections, setCollections] = useState<{ name: string }[]>([]);
  useEffect(() => { api<{ collections: { name: string }[] }>('/collections').then(d => setCollections(d.collections)).catch(e => setError(e.message)); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (key: keyof Question, value: string) => setQ({ ...q, [key]: value });
  return <Modal title={question ? '問題を編集' : '新しい問題を追加'} onClose={() => { if (!busy) onClose(); }}><form className="editor-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api(question ? `/questions/${encodeURIComponent(q.id)}` : '/questions', { method: question ? 'PUT' : 'POST', body: { ...q, retryAliases: retryAliases.split('\n').map(s => s.trim()).filter(Boolean), aliases: aliases.split('\n').map(s => s.trim()).filter(Boolean) } }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    {error && <ErrorBox error={error} />}
    <label>問題ID <span className="required">必須</span><input required maxLength={100} value={q.id} disabled={!!question || busy} onChange={e => change('id', e.target.value)} /><small>CSVでの再取り込みにも使う固定IDです。</small></label>
    <label>問題集<input list="collection-names" maxLength={100} value={q.collection} onChange={e => change('collection', e.target.value)} placeholder="例：abc本戦" /><datalist id="collection-names">{collections.filter(c => c.name).map(c => <option key={c.name} value={c.name} />)}</datalist></label>
    <div className="form-columns"><label>大ジャンル<input maxLength={100} value={q.majorCategory} onChange={e => change('majorCategory', e.target.value)} /></label><label>小ジャンル<input maxLength={100} value={q.minorCategory} onChange={e => change('minorCategory', e.target.value)} /></label></div>
    <label>問題文 <span className="required">必須</span><textarea required maxLength={4000} rows={3} value={q.text} onChange={e => change('text', e.target.value)} placeholder="例：日本で最も高い山は何でしょう？" /></label>
    <div className="form-columns"><label>正解 <span className="required">必須</span><input required maxLength={300} value={q.answer} onChange={e => change('answer', e.target.value)} placeholder="例：富士山" /></label><label>分野<input maxLength={100} value={q.category} onChange={e => change('category', e.target.value)} placeholder="例：地理" /></label></div>
    <label>正解として認める別表記<textarea rows={2} value={aliases} onChange={e => setAliases(e.target.value)} placeholder={'ふじさん\nフジサン'} /><small>1行に1つずつ。ひらがな・カタカナの違いは自動では吸収しません。</small></label>
    <label>「もう一回」と聞き直す答え（△）<textarea rows={2} value={retryAliases} onChange={e => setRetryAliases(e.target.value)} /><small>1行に1つずつ。正誤を確定せず、同じ問題に再回答します。</small></label>
    <details className="advanced"><summary>読み上げ・出典・メモを設定</summary><label>読み上げ用の問題文<textarea rows={3} maxLength={4000} value={q.reading} onChange={e => change('reading', e.target.value)} /></label><label>出典<input maxLength={1000} value={q.source} onChange={e => change('source', e.target.value)} /></label><label>メモ・解説<textarea rows={3} maxLength={4000} value={q.note} onChange={e => change('note', e.target.value)} /></label></details>
    <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>キャンセル</button><button className="button primary" disabled={busy}>{busy ? '保存しています…' : '保存する'}</button></div>
  </form></Modal>;
}

function ImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ existing: string[]; added: number; updated: number } | null>(null);
  const [fileName, setFileName] = useState('');
  const [collection, setCollection] = useState('');
  const [csvText, setCsvText] = useState('');
  const [processed, setProcessed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const prepare = async (items: Question[]) => {
    setBusy(true); setPreview(null); setConfirmed(false);
    try {
      const combined = { existing: [] as string[], added: 0, updated: 0 };
      for (let i = 0; i < items.length; i += 200) {
        const batch = await api<typeof combined>('/import/preview', { method: 'POST', body: items.slice(i, i + 200) });
        combined.existing.push(...batch.existing); combined.added += batch.added; combined.updated += batch.updated;
      }
      setPreview(combined);
    }
    catch (e) { setErrors([(e as Error).message]); } finally { setBusy(false); }
  };
  return <Modal title="CSVから問題を取り込む" subtitle="1ファイル10000問まで。200問ずつ登録します。文字コードはUTF-8で保存してください。" onClose={() => { if (!busy) onClose(); }}>
    <div className="import-help"><p>別解は「|」で区切ります。取り込み前に内容を確認できます。</p><div className="inline-actions"><button className="text-button" onClick={() => download('quiz-template.csv', questionsCsv(sampleQuestions), 'text/csv;charset=utf-8')}><Icon name="download" size={16} />例題付きテンプレート</button><button className="text-button" disabled={busy} onClick={() => { setCsvText(''); setFileName('動作確認用の例題（5問）'); setQuestions(sampleQuestions); setErrors([]); void prepare(sampleQuestions); }}>例題5問で試す</button></div></div>
    <label className="import-collection">取り込み先の問題集<input maxLength={100} value={collection} disabled={busy} onChange={e => {
      const name = e.target.value; setCollection(name); setPreview(null); setConfirmed(false);
      if (csvText) { const result = parseQuestionsCsv(csvText, { collection: name }); setQuestions(result.questions); setErrors(result.errors); }
    }} /><small>番号付きCSVでは、問題集名と番号で固定IDを作成します。再取り込み時は同じ名前を使ってください。</small></label>
    <label className="file-drop"><Icon name="upload" size={30} /><strong>CSVファイルを選ぶ</strong><span>{fileName || 'タップしてファイルを選択'}</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      setFileName(file.name); setPreview(null); setErrors([]); setQuestions([]); setConfirmed(false);
      if (file.size > 4 * 1024 * 1024) { setErrors(['ファイルは4MB以下に分けてください。']); return; }
      try {
        const text = await file.text(); setCsvText(text);
        const name = collection || file.name.replace(/\.csv$/i, '').replace(/^クイズ練習\s*-\s*/, '').slice(0, 100); setCollection(name);
        const result = parseQuestionsCsv(text, { collection: name }); setQuestions(result.questions); setErrors(result.errors);
        if (!result.errors.length) await prepare(result.questions);
      } catch { setErrors(['ファイルを読み込めませんでした。UTF-8のCSVか確認してください。']); }
    }} /></label>
    {!!questions.length && !preview && !busy && !errors.length && <button className="button secondary" onClick={() => void prepare(questions)}>取り込み内容を確認</button>}
    {!!errors.length && <div className="error" role="alert"><strong>取り込む前に修正してください</strong><ul>{errors.slice(0, 20).map((s, i) => <li key={i}>{s}</li>)}</ul>{errors.length > 20 && <p>ほか{errors.length - 20}件</p>}</div>}
    {busy && !preview && <Loading />}
    {preview && !errors.length && <><div className="import-summary"><span>追加 <strong>{preview.added}</strong> 問</span><span>更新 <strong>{preview.updated}</strong> 問</span></div><div className="preview-table"><table><thead><tr><th>ID</th><th>問題文 / 正解・別解・△</th><th>処理</th></tr></thead><tbody>{questions.slice(0, 20).map(q => <tr key={q.id}><td>{q.id}</td><td>{q.text}<small>{q.answer}<br />{[q.collection, q.majorCategory, q.minorCategory].filter(Boolean).join(" / ")}<br />別解：{q.aliases.join(" ／ ") || "なし"}<br />△：{q.retryAliases.join(" ／ ") || "なし"}</small></td><td>{preview.existing.includes(q.id) ? '更新' : '追加'}</td></tr>)}</tbody></table></div>{questions.length > 20 && <p className="muted">先頭20問を表示しています。合計{questions.length}問を取り込みます。</p>}{preview.updated > 0 && <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />同じIDの問題を更新することを確認しました。お気に入りと過去の履歴は維持されます。</label>}</>}
    <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onClose}>閉じる</button><button className="button primary" disabled={busy || !preview || !!errors.length || preview.updated > 0 && !confirmed} onClick={async () => {
      setBusy(true); setProcessed(0); let done = 0;
      try { for (let i = 0; i < questions.length; i += 200) { await api('/import', { method: 'POST', body: questions.slice(i, i + 200) }); done += questions.slice(i, i + 200).length; setProcessed(done); } onSaved(); }
      catch (e) { setPreview(null); setErrors([done + '問まで登録済みです。再度ファイルを選んで取り込むと同じIDで更新・再開できます。' + (e as Error).message]); } finally { setBusy(false); }
    }}>{busy ? `${processed}問 登録済み…` : `${questions.length || ''}問を取り込む`}</button></div>
  </Modal>;
}

interface HistoryRow { hidden: number; id: string; question_text: string; answer: string; aliases: string[]; submitted_answer: string; correct: number; overridden: number; skipped: number; answered_at: string }
function History({ stats }: { stats: Stats | null }) {
  const route = useRoute();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const page = listPage(route.params);
  const setPage = (value: number) => updateQuery({ page: value === 1 ? null : String(value) });
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<{ history: HistoryRow[]; total: number }>(`/history?page=${page}`).then(data => { if (active) { setRows(data.history); setTotal(data.total); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, version]);
  return <><div className="stats-grid"><Stat label="これまでの解答" value={stats?.answered} unit="問" icon="book" /><Stat label="正解した回数" value={stats?.correct} unit="問" icon="check" /><Stat label="今日の解答" value={stats?.today} unit="問" icon="headphones" /></div><section className="card"><div className="list-heading"><h2>これまでの練習<span>{total} 件</span></h2></div>{error && <ErrorBox error={error} retry={() => setVersion(v => v + 1)} />}{loading ? <Loading /> : !rows.length ? <Empty icon="history" title="解答履歴はありません"></Empty> : <div className="history-list">{rows.map(r => <article key={r.id} className="history-row"><span className={`history-symbol ${r.skipped ? 'skipped' : r.correct ? 'correct' : 'incorrect'}`} aria-label={r.skipped ? 'スキップ' : r.correct ? '正解' : '不正解'}><Icon name={r.skipped ? 'arrow' : r.correct ? 'check' : 'close'} /></span><div><time>{new Date(r.answered_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><h3>{r.question_text}</h3>{!!r.hidden && <span className="hidden-badge">非表示</span>}<AnswerDetails answer={r.answer} aliases={r.aliases} submittedAnswer={r.skipped ? '未回答（正解率の集計対象外）' : r.submitted_answer} />{!!r.overridden && <small>自分で正解扱いに変更</small>}</div></article>)}</div>}<Pager page={page} total={total} onChange={setPage} /></section></>;
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
  return <div className="settings-grid"><section className="card settings-card"><div className="section-label"><Icon name="volume" />練習の設定</div><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); setMessage(''); try { const s = await api<Settings>('/settings', { method: 'PUT', body: draft }); onSave(s); setMessage('設定を保存しました。'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><label className="range-label">読み上げ速度<strong>{draft.rate.toFixed(1)} 倍</strong><input type="range" min="0.5" max="2" step="0.1" value={draft.rate} onChange={e => setDraft({ ...draft, rate: Number(e.target.value) })} /></label><div className="range-markers"><span>ゆっくり</span><span>はやく</span></div><label className="toggle-label"><div><strong>問題文を常に表示</strong></div><input type="checkbox" role="switch" checked={draft.showQuestion} onChange={e => setDraft({ ...draft, showQuestion: e.target.checked })} /></label><button className="button primary" disabled={busy}>{busy ? '処理しています…' : '設定を保存'}</button></form></section><section className="card settings-card"><div className="section-label"><Icon name="download" />データの書き出し</div><div className="export-actions"><button className="button secondary" disabled={busy} onClick={() => void backup(true)}><Icon name="download" />問題をCSVで保存</button><button className="button secondary" disabled={busy} onClick={() => void backup(false)}><Icon name="download" />全データをJSONで保存</button></div><p className="small-note">JSONからの一括復元画面は初版の対象外です。完全な復元用バックアップの作成手順はREADMEに記載しています。</p></section>{error && <ErrorBox error={error} />}{message && <div className="success" role="status"><Icon name="check" />{message}</div>}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
