import '@fontsource-variable/manrope';
import './style.css';
import { CubeModel, COLORS, FACES, tokens, inverse, simplify, scramble, parseMove } from './cube.js';
import { CubeView } from './view.js';
import { COURSES, describeMove } from './lessons.js';
import { icon } from './icons.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
let storageAvailable = true;
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { storageAvailable = false; } };
const saved = read('kub.session', {});
const preferences = { speed: 330, sound: false, labels: false, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, ...read('kub.preferences', {}) };
const state = {
  size: [2, 3, 4, 5].includes(saved.size) ? saved.size : 3,
  mode: saved.mode === 'free' ? 'free' : 'learn',
  lessonIndex: 0, step: 0, history: [], redo: [],
  busy: false, playing: false, operation: null, solution: null, solutionStep: 0, solutionSource: 'history',
  prime: false, double: false, layer: 'outer', turnMode: false,
  progress: read('kub.progress', {}), records: read('kub.records', []),
  running: false, elapsed: 0, started: 0, attempt: false, assisted: false,
};
let model = new CubeModel(state.size);
let view, solverWorker, audioContext, toastTimeout;
let solveRequest = 0;
const currentLesson = () => COURSES[state.size].lessons[state.lessonIndex];
const lessonMoves = () => tokens(currentLesson().algorithm);
const complete = () => state.mode === 'learn' && state.step === lessonMoves().length;

$('#app').innerHTML = `
  <header class="header">
    <a class="brand" href="./" aria-label="КуБ — на главную"><span class="brand-mark">${icon('cube')}</span><span>КуБ<span class="brand-dot">.</span></span></a>
    <nav class="navigation" aria-label="Режимы тренажёра">
      <button class="nav-item" data-mode="learn">${icon('book')}<span>Обучение</span></button>
      <button class="nav-item" data-mode="free">${icon('explore')}<span>Свободная сборка</span></button>
      <button class="nav-item" id="algorithms-open">${icon('list')}<span>Алгоритмы</span></button>
    </nav>
    <div class="header-tools"><span class="local-badge"><span></span>Твой прогресс сохраняется</span><button class="icon-button" id="settings-open" aria-label="Настройки">${icon('settings')}</button><button class="help-button" id="help-open" aria-label="Как пользоваться">?</button></div>
  </header>
  <main class="main">
    <section class="intro"><div><div class="eyebrow"><span class="tiny-square"></span> МАЛЕНЬКИЕ ШАГИ. БОЛЬШИЕ ПОБЕДЫ.</div><h1>Всё сложится<span>.</span></h1><p>Крути, пробуй, понимай. Один поворот за другим.</p></div><div class="intro-note"><span>Без спешки.<br>В твоём темпе.</span><svg viewBox="0 0 100 60" fill="none" aria-hidden="true"><path d="M6 7c18 46 47 42 80 23M70 27l19 1-8 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div></section>
    <section class="workspace" aria-label="Тренажёр кубика">
      <div class="simulator">
        <div class="cube-toolbar"><div class="cube-choice"><span class="toolbar-label">Твой кубик</span><div class="size-picker" role="group" aria-label="Размер кубика">${[2, 3, 4, 5].map(n => `<button data-size="${n}" aria-label="Кубик ${n} на ${n}">${n}×${n}</button>`).join('')}</div></div><span class="level-badge" id="level-badge">КЛАССИКА</span></div>
        <div class="stage">
          <div class="stage-top"><div class="view-mode" role="group" aria-label="Способ управления"><button data-view-mode="orbit" class="active" title="Перетаскивание вращает камеру">${icon('hand')}<span>Обзор</span></button><button data-view-mode="turn" title="Смахивание по наклейке вращает слой">${icon('cube')}<span>Слои</span></button></div><span class="stage-status" id="stage-status"><span></span>Учебный случай</span></div>
          <span class="stage-watermark" aria-hidden="true">3×3</span><div class="cube-canvas" id="cube-canvas"></div><div class="cube-shadow" aria-hidden="true"></div>
          <div class="stage-tools"><button class="glass-button" id="camera-home" aria-label="Вернуть вид камеры" title="Вернуть вид камеры">${icon('focus')}</button><button class="glass-button" id="zoom-in" aria-label="Приблизить" title="Приблизить">${icon('plus')}</button><button class="glass-button" id="zoom-out" aria-label="Отдалить" title="Отдалить">${icon('minus')}</button><span></span><button class="glass-button" id="net-toggle" aria-label="Показать развёртку" aria-pressed="false" title="Развёртка">${icon('net')}</button></div>
          <div class="stage-bottom"><span id="gesture-hint">${icon('explore')} Вращай, чтобы рассмотреть</span><span class="orientation-hint"><i style="--dot:${COLORS.U}"></i>верх<i style="--dot:${COLORS.F}"></i>перед</span></div>
          <div id="cube-net" class="cube-net" hidden></div><div class="solved-stamp" id="solved-stamp" hidden>${icon('check')} Всё сложилось!</div>
        </div>
        <div class="move-panel">
          <div class="move-header"><span class="toolbar-label">Управление гранями <button class="text-help" id="notation-open" aria-label="Обозначения ходов">?</button></span><div class="move-modifiers"><select id="layer-select" aria-label="Поворачиваемый слой"><option value="outer">Внешний слой</option><option value="inner">Внутренний · 2R</option><option value="wide">Два слоя · Rw</option></select><button class="modifier" id="prime-toggle" aria-pressed="false" title="Обратные повороты">Обратно <b>′</b></button><button class="modifier" id="double-toggle" aria-pressed="false" title="Половина оборота">×2</button></div></div>
          <div class="face-buttons" role="group" aria-label="Повороты граней">${['U', 'D', 'L', 'R', 'F', 'B'].map(face => `<button class="face-button" data-face="${face}" title="${face} — ${ { U: 'верхняя', D: 'нижняя', L: 'левая', R: 'правая', F: 'передняя', B: 'задняя' }[face]} грань"><span class="face-color" style="--face-color:${COLORS[face]}"></span><b>${face}</b><span class="face-direction">↻</span></button>`).join('')}</div>
          <div class="history-line"><span class="history-label">ХОДЫ</span><div id="history" class="history-tokens" aria-label="История ходов">Твой первый ход — впереди</div><span class="move-count" id="move-count">0</span></div>
          <div class="cube-actions"><div class="undo-actions"><button class="icon-button" id="undo" aria-label="Отменить ход" title="Отменить · Ctrl+Z">${icon('undo')}</button><button class="icon-button" id="redo" aria-label="Повторить ход" title="Повторить · Ctrl+Y">${icon('redo')}</button></div><div class="right-actions"><button class="subtle-button" id="reset">${icon('reset')}<span>Сначала</span></button><button class="subtle-button" id="scramble">${icon('shuffle')}<span>Перемешать</span></button></div></div>
        </div>
      </div>
      <aside class="sidebar"><div class="coach-card" id="coach"></div><div class="shortcut-note">${icon('keyboard')}<span>Поворачивай клавишами <b>R U F…</b><br><kbd>Shift</kbd> — обратно · <kbd>Пробел</kbd> — следующий ход</span></div></aside>
    </section>
    <section id="journey" class="journey"></section>
    <footer class="footer"><span class="footer-brand">КуБ<span>.</span> <span>Всё начинается с одного поворота.</span></span><button class="footer-help" id="footer-help">Как это работает ${icon('arrow')}</button><span class="footer-small">Без регистрации. В своём темпе.</span></footer>
  </main>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <dialog id="dialog" class="dialog"><div class="dialog-top"><span class="eyebrow" id="dialog-eyebrow">ПОЛЕЗНО ЗНАТЬ</span><button id="dialog-close" class="icon-button" aria-label="Закрыть">${icon('close')}</button></div><div id="dialog-content"></div></dialog>
`;

function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 3600);
}

function persist() {
  save('kub.progress', state.progress); save('kub.records', state.records);
  save('kub.preferences', preferences);
  save('kub.session', { size: state.size, mode: state.mode, history: state.mode === 'free' ? state.history : [] });
}

function sound() {
  if (!preferences.sound) return;
  try {
    audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(650, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, audioContext.currentTime + 0.045);
    gain.gain.setValueAtTime(0.025, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.055);
    osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + 0.06);
  } catch { /* Sound is optional. */ }
}

function elapsed() { return state.elapsed + (state.running ? performance.now() - state.started : 0); }
function formatTime(ms) {
  const cs = Math.floor(ms / 10);
  return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}<span>.${String(cs % 100).padStart(2, '0')}</span>`;
}
function startTimer() { if (!state.running) { state.started = performance.now(); state.running = true; } }
function stopTimer() { if (state.running) { state.elapsed = elapsed(); state.running = false; } }

function drawCoach() {
  const coach = $('#coach');
  if (state.mode === 'learn') {
    const course = COURSES[state.size], lesson = currentLesson(), moves = lessonMoves();
    const done = course.lessons.filter(l => state.progress[l.id]).length;
    const finished = complete();
    coach.innerHTML = `
      <div class="coach-heading"><span class="coach-icon">${icon('book')}</span><div><h2>Давай по шагам</h2><span>Понимание приходит с практикой</span></div></div>
      <div class="course-progress"><div><span>Твой путь · ${state.size}×${state.size}</span><b>${done}<span> / ${course.lessons.length}</span></b></div><div class="progress-track"><span style="width:${done / course.lessons.length * 100}%"></span></div></div>
      <label class="lesson-select-label" for="lesson-select">Выбрать урок</label><div class="lesson-select-wrap"><select id="lesson-select" aria-label="Урок">${course.lessons.map((l, i) => `<option value="${i}" ${i === state.lessonIndex ? 'selected' : ''}>${String(i + 1).padStart(2, '0')} · ${l.title}${state.progress[l.id] ? ' ✓' : ''}</option>`).join('')}</select>${icon('down')}</div>
      <div class="lesson-body"><div class="step-eyebrow">УРОК ${String(state.lessonIndex + 1).padStart(2, '0')} <span>/ ${String(course.lessons.length).padStart(2, '0')}</span></div><h3>${lesson.title}</h3><p class="lesson-goal">${lesson.goal}</p>
      ${finished ? `<div class="lesson-success"><span>${icon('check')}</span><h4>Отлично, получилось!</h4><p>Ещё один маленький шаг вперёд.<br>Закрепи его или попробуй следующий.</p></div>` : `<div class="next-move"><div><span>ТВОЙ СЛЕДУЮЩИЙ ХОД</span><b>${escape(moves[state.step])}<span>${moves[state.step].endsWith("'") ? '↶' : '↷'}</span></b></div><span class="move-number">${state.step + 1}<span>/${moves.length}</span></span><p>${describeMove(moves[state.step])}</p></div>`}
      <div class="algorithm-label"><span>Формула урока</span><span>${state.step} / ${moves.length} ходов</span></div><div class="algorithm-chips" aria-label="Формула урока">${moves.map((m, i) => `<span class="algorithm-chip ${i < state.step ? 'done' : i === state.step ? 'current' : ''}">${escape(m)}</span>`).join('')}</div>
      <div class="lesson-playback">${finished ? `<button class="primary-button" id="next-lesson">${state.lessonIndex === course.lessons.length - 1 ? 'Повторить курс' : 'Следующий урок'}${icon('arrow')}</button><button class="square-button" id="lesson-restart" aria-label="Повторить урок">${icon('reset')}</button>` : `<button class="primary-button" id="play">${icon(state.playing ? 'pause' : 'play')}<span>${state.playing ? 'Пауза' : state.step ? 'Продолжить показ' : 'Показать алгоритм'}</span></button><button class="square-button" id="step" aria-label="Выполнить следующий ход" title="Следующий ход · Пробел">${icon('chevron')}</button>`}</div>
      <div class="lesson-tip">${icon('bulb')}<p>${lesson.tip}</p></div><details class="theory" ${state.theoryOpen ? 'open' : ''}><summary>Почему это работает ${icon('plus')}</summary><p>${lesson.theory}</p><span class="exercise-notice">Это отдельный учебный случай. При выборе урока кубик подготавливается заново.</span></details></div>`;
    $('#lesson-select').addEventListener('change', e => loadLesson(Number(e.target.value)));
    $('#play')?.addEventListener('click', playLesson);
    $('#step')?.addEventListener('click', () => perform(moves[state.step], 'lesson'));
    $('#next-lesson')?.addEventListener('click', () => loadLesson((state.lessonIndex + 1) % course.lessons.length));
    $('#lesson-restart')?.addEventListener('click', () => loadLesson(state.lessonIndex));
    $('.theory').addEventListener('toggle', e => { state.theoryOpen = e.target.open; });
  } else {
    const records = state.records.filter(r => r.size === state.size);
    const best = records.length ? Math.min(...records.map(r => r.time)) : null;
    const solution = state.solution;
    coach.innerHTML = `
      <div class="coach-heading"><span class="coach-icon">${icon('explore')}</span><div><h2>Твоё пространство</h2><span>Никаких правил. Только практика.</span></div></div>
      <div class="practice-timer"><div class="timer-eyebrow">${icon('clock')} ВРЕМЯ СБОРКИ</div><div id="timer" class="timer-value">${formatTime(elapsed())}</div><div class="timer-status" id="timer-status">${state.running ? 'Сборка идёт' : state.attempt ? 'Таймер начнётся с первого хода' : 'Перемешай кубик, чтобы начать'}</div></div>
      <div class="practice-stats"><div><span>Ходы</span><b id="practice-moves">${state.userMoves || 0}</b></div><div><span>Лучшее время</span><b>${best === null ? '—' : formatTime(best)}</b></div></div>
      <div class="practice-body"><h3>Нужна подсказка?</h3><p class="lesson-goal">Посмотри решение по одному ходу или запусти всю последовательность.</p>
      ${solution ? `<div class="solution-meta"><span>${state.solutionSource === 'solver' ? 'Решение кубика' : 'Возврат по истории'}</span><b>${state.solutionStep} / ${solution.length}</b></div><div class="algorithm-chips solution-chips">${solution.map((m, i) => `<span class="algorithm-chip ${i < state.solutionStep ? 'done' : i === state.solutionStep ? 'current' : ''}">${escape(m)}</span>`).join('')}</div><div class="lesson-playback"><button class="primary-button" id="solution-play">${icon(state.playing ? 'pause' : 'play')}<span>${state.playing ? 'Пауза' : 'Показать решение'}</span></button><button class="square-button" id="solution-step" aria-label="Следующий ход решения">${icon('chevron')}</button></div>` : `<button class="primary-button solve-button" id="solve">${icon('bulb')}<span>Найти решение</span>${icon('arrow')}</button>`}
      <div class="manual-algorithm"><label for="algorithm-input">Или введи свою формулу</label><form id="algorithm-form"><input id="algorithm-input" name="algorithm" placeholder="R U R' U'" autocomplete="off" spellcheck="false" aria-label="Своя формула" maxlength="1000"><button class="square-button" type="submit" aria-label="Выполнить формулу">${icon('arrow')}</button></form>${state.operation === 'algorithm' ? `<button class="subtle-button" id="algorithm-stop">${icon('pause')} Остановить формулу</button>` : ''}</div><div class="lesson-tip">${icon('bulb')}<p>${state.size === 3 ? 'Для 3×3 решение рассчитывается отдельно. На других размерах тренажёр возвращает кубик по истории ходов.' : 'Включи «Слои» над кубиком и смахни по наклейке. Внутренние слои также доступны в меню управления.'} Подсказки не попадают в рекорды.</p></div></div>`;
    $('#solve')?.addEventListener('click', findSolution);
    $('#solution-play')?.addEventListener('click', playSolution);
    $('#solution-step')?.addEventListener('click', () => perform(state.solution[state.solutionStep], 'solution'));
    $('#algorithm-form').addEventListener('submit', e => { e.preventDefault(); runAlgorithm($('#algorithm-input').value); });
    $('#algorithm-stop')?.addEventListener('click', () => { state.playing = false; });
  }
  syncDisabled();
}

function drawJourney() {
  const course = COURSES[state.size];
  if (state.mode === 'learn') {
    $('#journey').innerHTML = `<div class="journey-heading"><div><div class="eyebrow">ТВОЙ МАРШРУТ · ${state.size}×${state.size}</div><h2>${course.name}</h2></div><span class="course-level">${course.level} ${icon('arrow')}</span></div><p class="journey-intro">${course.intro}</p><div class="lesson-grid">${course.lessons.map((l, i) => `<button class="lesson-tile ${i === state.lessonIndex ? 'active' : ''} ${state.progress[l.id] ? 'completed' : ''}" data-lesson="${i}"><span class="lesson-number">${state.progress[l.id] ? icon('check') : String(i + 1).padStart(2, '0')}</span><span>${l.title}</span>${icon('arrow')}</button>`).join('')}</div>`;
    $$('[data-lesson]').forEach(b => b.addEventListener('click', () => loadLesson(Number(b.dataset.lesson))));
  } else {
    const records = state.records.filter(r => r.size === state.size).slice(0, 8);
    $('#journey').innerHTML = `<div class="journey-heading"><div><div class="eyebrow">ПРАКТИКА · ${state.size}×${state.size}</div><h2>Каждый раз немного лучше.</h2></div><span class="course-level">${icon('trophy')} Твои сборки</span></div>${records.length ? `<div class="record-grid">${records.map((r, i) => `<div class="record-tile"><span class="record-index">${String(i + 1).padStart(2, '0')}</span><b>${formatTime(r.time)}</b><span>${r.moves} ходов · ${new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span></div>`).join('')}</div>` : `<div class="empty-records">${icon('trophy')}<div><b>Твой первый рекорд ещё впереди</b><span>Перемешай и собери кубик без подсказок — результат появится здесь.</span></div><button class="subtle-button" id="record-scramble">Начать ${icon('arrow')}</button></div>`}`;
    $('#record-scramble')?.addEventListener('click', shuffleCube);
  }
}

function drawNet() {
  if ($('#cube-net').hidden) return;
  $('#cube-net').innerHTML = FACES.map(f => `<div class="net-face net-${f}" style="--n:${state.size}">${model.facelets(f).map(color => `<span style="background:${COLORS[color]}" title="${f}: ${color}">${preferences.labels ? color : ''}</span>`).join('')}</div>`).join('');
}

function drawStatus() {
  const solved = model.isSolved();
  $('#history').innerHTML = state.history.length ? state.history.slice(-28).map(m => `<span>${escape(m)}</span>`).join('') : 'Твой первый ход — впереди';
  $('#history').scrollLeft = $('#history').scrollWidth;
  $('#move-count').textContent = state.history.length;
  $('#solved-stamp').hidden = !solved || (state.mode === 'learn' && !complete());
  $('#stage-status').innerHTML = `<span></span>${state.busy && !state.playing ? 'Поворот за поворотом' : state.mode === 'learn' ? complete() ? 'Урок пройден' : 'Учебный случай' : solved ? 'Кубик собран' : 'Свободная сборка'}`;
  if ($('#practice-moves')) $('#practice-moves').textContent = state.userMoves || 0;
  drawNet(); syncDisabled(); persist();
}

function syncDisabled() {
  for (const el of $$('[data-size], [data-mode], [data-lesson], [data-face], #lesson-select, #reset, #scramble, #step, #solution-step, #solve, #algorithm-input, #algorithm-form button, #layer-select, #lesson-restart, #next-lesson, #record-scramble')) el.disabled = state.busy;
  $('#undo').disabled = state.busy || !state.history.length;
  $('#redo').disabled = state.busy || !state.redo.length;
  $('#settings-open').disabled = state.busy;
  $('#algorithms-open').disabled = state.busy;
  $('#play')?.toggleAttribute('disabled', state.busy && !state.playing);
  $('#solution-play')?.toggleAttribute('disabled', state.busy && !state.playing);
  $('#solution-play')?.toggleAttribute('disabled', (state.busy && !state.playing) || (state.solution && state.solutionStep >= state.solution.length));
  $('#solution-step')?.toggleAttribute('disabled', state.busy || (state.solution && state.solutionStep >= state.solution.length));
}

function drawShell() {
  $$('[data-size]').forEach(b => { b.classList.toggle('active', Number(b.dataset.size) === state.size); b.setAttribute('aria-pressed', Number(b.dataset.size) === state.size); });
  $$('[data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === state.mode); b.setAttribute('aria-pressed', b.dataset.mode === state.mode); });
  $('.stage-watermark').textContent = `${state.size}×${state.size}`;
  $('#level-badge').textContent = { 2: 'ПЕРВЫЕ ШАГИ', 3: 'КЛАССИКА', 4: 'НОВЫЙ УРОВЕНЬ', 5: 'БОЛЬШЕ ВОЗМОЖНОСТЕЙ' }[state.size];
  $('#layer-select').hidden = state.size < 4;
  $('#layer-select').value = state.layer;
  $('#scramble').title = state.mode === 'learn' ? 'Перейти в свободный режим и перемешать кубик' : 'Новое перемешивание';
  drawCoach(); drawJourney(); drawStatus(); drawModifiers();
}

function resetTimer() { state.running = false; state.elapsed = 0; state.attempt = false; state.assisted = false; state.userMoves = 0; }

function loadLesson(index) {
  if (state.busy) return;
  resetTimer(); state.lessonIndex = index; state.step = 0; state.history = []; state.redo = []; state.solution = null; state.solutionStep = 0;
  model.reset().move(inverse(lessonMoves())); view?.rebuild(model); drawShell();
}

function changeMode(mode) {
  if (state.busy || state.mode === mode) return;
  stopTimer(); state.mode = mode; state.playing = false; state.solution = null; state.solutionStep = 0;
  if (mode === 'learn') loadLesson(state.lessonIndex);
  else { model.reset(); state.history = []; state.redo = []; resetTimer(); view?.rebuild(model); drawShell(); }
}

function changeSize(size) {
  if (state.busy || size === state.size) return;
  stopTimer(); state.size = size; state.layer = 'outer'; state.lessonIndex = 0; state.history = []; state.redo = []; state.solution = null; state.solutionStep = 0; resetTimer(); model = new CubeModel(size);
  if (state.mode === 'learn') loadLesson(0); else { view?.rebuild(model); drawShell(); }
}

function moveForFace(face, override = {}) {
  const prefix = state.layer === 'inner' && state.size >= 4 ? '2' : '';
  const wide = state.layer === 'wide' && state.size >= 4 ? 'w' : '';
  return prefix + face + wide + ((override.double ?? state.double) ? '2' : (override.prime ?? state.prime) ? "'" : '');
}

function finishTurn(token, source) {
  state.history.push(token); state.redo = [];
  if (state.mode === 'learn') {
    state.step++;
    if (complete()) { state.progress[currentLesson().id] = true; toast('Получилось! Урок пройден.'); drawJourney(); }
  } else {
    if (source === 'solution') state.solutionStep++;
    else { state.solution = null; state.solutionStep = 0; }
    state.userMoves = (state.userMoves || 0) + 1;
    if (model.isSolved()) {
      stopTimer();
      if (state.attempt && !state.assisted) {
        state.records.unshift({ size: state.size, time: state.elapsed, moves: state.userMoves, date: new Date().toISOString() });
        state.records = state.records.slice(0, 100);
        toast('Кубик собран. Новый результат сохранён!'); drawJourney();
      } else if (state.history.length) toast('Все шесть граней на месте!');
      state.attempt = false;
    }
  }
  drawStatus();
}

async function perform(token, source = 'manual', inSequence = false) {
  if (!token || (state.busy && !inSequence)) return false;
  if (state.mode === 'learn' && (complete() || token !== lessonMoves()[state.step])) {
    if (!complete()) toast(`Сейчас попробуй ${lessonMoves()[state.step]}. ${describeMove(lessonMoves()[state.step])}`);
    else toast('Урок уже пройден. Выбери следующий или повтори его.');
    return false;
  }
  try { parseMove(token, state.size); } catch (error) { toast(error.message); return false; }
  if (state.mode === 'free' && state.attempt && !state.running) startTimer();
  if (!inSequence) { state.busy = true; syncDisabled(); }
  try {
    await view.turn(token, preferences.reduced ? 0 : Number(preferences.speed));
    sound(); finishTurn(token, source);
    return true;
  } finally {
    if (!inSequence) { state.busy = false; drawCoach(); drawStatus(); }
  }
}

async function playLesson() {
  if (state.playing) { state.playing = false; return; }
  if (state.busy || complete()) return;
  state.playing = true; state.busy = true; drawCoach();
  try {
    while (state.playing && !complete()) {
      await perform(lessonMoves()[state.step], 'lesson', true);
      if (state.playing && !complete()) { drawCoach(); await new Promise(r => setTimeout(r, preferences.reduced ? 20 : 220)); }
    }
  } finally { state.playing = false; state.busy = false; drawCoach(); drawStatus(); }
}

async function playSolution() {
  if (state.playing) { state.playing = false; return; }
  if (state.busy || !state.solution) return;
  state.playing = true; state.busy = true; state.assisted = true; drawCoach();
  try {
    while (state.playing && state.solutionStep < state.solution.length) {
      await perform(state.solution[state.solutionStep], 'solution', true);
      if (state.playing && state.solutionStep < state.solution.length) { drawCoach(); await new Promise(r => setTimeout(r, preferences.reduced ? 10 : 90)); }
    }
  } finally { state.playing = false; state.busy = false; drawCoach(); drawStatus(); }
}

async function shuffleCube() {
  if (state.busy) return;
  state.mode = 'free'; state.busy = true; state.playing = false; state.solution = null; state.solutionStep = 0; state.history = []; state.redo = []; resetTimer();
  model.reset(); view.rebuild(model); drawShell();
  const moves = scramble(state.size);
  try {
    // A single final rebuild keeps larger puzzles responsive, including on phones.
    model.move(moves); state.history = moves; view.rebuild(model);
    state.attempt = true; toast('Кубик перемешан. Таймер начнётся с первого хода.');
  } finally { state.busy = false; drawCoach(); drawStatus(); }
}

async function undo() {
  if (state.busy || !state.history.length) return;
  state.busy = true; syncDisabled();
  const token = state.history.pop();
  try {
    await view.turn(inverse([token])[0], preferences.reduced ? 0 : Number(preferences.speed));
    state.redo.push(token);
    if (state.mode === 'learn') state.step = Math.max(0, state.step - 1);
    else { state.assisted = true; state.solution = null; state.solutionStep = 0; }
    if (model.isSolved()) { stopTimer(); state.attempt = false; }
  } finally { state.busy = false; drawCoach(); drawStatus(); }
}

async function redo() {
  if (state.busy || !state.redo.length) return;
  const token = state.redo.pop(), remaining = [...state.redo];
  await perform(token, 'redo'); state.redo = remaining; syncDisabled();
}

function workerSolve(facelets) {
  return new Promise((resolve, reject) => {
    solverWorker ??= new Worker(new URL('solver.worker.js', document.baseURI));
    const id = `solve-${++solveRequest}`;
    const timeout = setTimeout(() => { solverWorker.terminate(); solverWorker = null; reject(new Error('Вычисление заняло слишком много времени')); }, 30000);
    const cleanup = () => { clearTimeout(timeout); solverWorker?.removeEventListener('message', onMessage); solverWorker?.removeEventListener('error', onError); };
    const onMessage = ({ data }) => { if (data.id !== id) return; cleanup(); data.error ? reject(new Error(data.error)) : resolve(tokens(data.solution)); };
    const onError = () => { cleanup(); solverWorker?.terminate(); solverWorker = null; reject(new Error('Не удалось запустить решатель')); };
    solverWorker.addEventListener('message', onMessage); solverWorker.addEventListener('error', onError);
    solverWorker.postMessage({ id, facelets });
  });
}

async function findSolution() {
  if (state.busy) return;
  if (model.isSolved()) { toast('Кубик уже собран. Попробуй перемешать его.'); return; }
  state.busy = true; state.assisted = true; syncDisabled();
  if ($('#solve')) $('#solve').innerHTML = `${icon('spark')}<span>Ищу путь к решению…</span>`;
  try {
    let solution;
    state.solutionSource = 'history';
    if (state.size === 3) {
      // Middle slice moves can rotate the center frame. Normalize its colors before solving.
      const mapping = Object.fromEntries(FACES.map(f => [model.facelets(f)[4], f]));
      const facelets = [...model.asString()].map(c => mapping[c]).join('');
      try {
        solution = await workerSolve(facelets);
        if (!new CubeModel(3).move(state.history).move(solution).isSolved()) throw new Error('Проверка решения не пройдена');
        state.solutionSource = 'solver';
      } catch (error) { console.warn('Cube solver fallback:', error.message); solution = simplify(inverse(state.history)); toast('Использую надёжный возврат по истории ходов.'); }
    } else solution = simplify(inverse(state.history));
    // Verify every solution before presenting it.
    const check = new CubeModel(state.size).move(state.history).move(solution);
    if (!check.isSolved()) throw new Error('Не удалось проверить решение. Начни с нового перемешивания.');
    state.solution = solution; state.solutionStep = 0;
  } catch (error) { toast(error.message); }
  finally { state.busy = false; drawCoach(); drawStatus(); }
}

async function runAlgorithm(input) {
  if (state.busy) return;
  const moves = tokens(input);
  if (!moves.length) { toast('Введи формулу, например R U R′ U′.'); return; }
  if (moves.length > 100) { toast('За один раз можно выполнить до 100 ходов.'); return; }
  try { moves.forEach(m => parseMove(m, state.size)); } catch (error) { toast(error.message); return; }
  state.busy = true; state.assisted = true; state.playing = true; state.operation = 'algorithm'; drawCoach();
  try { for (const move of moves) { if (!state.playing) break; await perform(move, 'algorithm', true); } }
  finally { state.busy = false; state.playing = false; state.operation = null; drawCoach(); drawStatus(); }
}

function modal(title, content, eyebrow = 'ПОЛЕЗНО ЗНАТЬ') {
  $('#dialog-eyebrow').textContent = eyebrow;
  $('#dialog-content').innerHTML = `<h2>${title}</h2>${content}`;
  $('#dialog').showModal();
}

function showHelp() {
  modal('Один поворот — и всё понятнее.', `<p>Выбери размер кубика и режим. В обучении каждый урок открывает отдельный подготовленный случай. Повторяй подсказанные ходы кнопками или смотри анимацию по шагам.</p><div class="help-grid"><div>${icon('hand')}<h3>Рассмотри</h3><p>В режиме «Обзор» перетаскивай кубик для вращения камеры. Масштаб меняется колёсиком, щипком или кнопками + и −.</p></div><div>${icon('cube')}<h3>Поверни</h3><p>Включи «Слои» и смахни по наклейке. Кнопки под кубиком всегда выполняют точный ход независимо от камеры.</p></div></div><h3>Как читать формулы</h3><div class="notation-grid">${[['U', 'Верхняя'], ['D', 'Нижняя'], ['R', 'Правая'], ['L', 'Левая'], ['F', 'Передняя'], ['B', 'Задняя']].map(([f, name]) => `<div><b style="--face-color:${COLORS[f]}">${f}</b><span>${name}</span></div>`).join('')}</div><p><b>R</b> — 90° по часовой стрелке, если смотреть прямо на правую грань снаружи. <b>R′</b> — 90° обратно. <b>R2</b> — 180°. <b>Rw</b> — два правых слоя вместе. <b>2R</b> — только второй слой справа.</p><p>Буквы привязаны к исходным осям кубика: жёлтый центр — U, зелёный — F. Поворот камеры их не меняет. Кнопка ${icon('focus')} возвращает исходный вид.</p><h3>Клавиатура</h3><p><kbd>R</kbd> <kbd>U</kbd> <kbd>F</kbd> <kbd>D</kbd> <kbd>L</kbd> <kbd>B</kbd> — повороты; <kbd>Shift</kbd> — обратно; <kbd>Пробел</kbd> — следующий ход урока или решения; <kbd>Ctrl/⌘ + Z</kbd> — отмена; <kbd>Ctrl/⌘ + Y</kbd> — повтор.</p><p class="muted">Рекорды и пройденные уроки хранятся только в этом браузере. Очистка данных браузера удалит их. Время считается с первого хода после перемешивания. Решение с подсказками, формулой или отменой не записывается как рекорд.</p>`);
}

function showSettings() {
  modal('Твой удобный ритм.', `<div class="setting-row speed-setting"><div><b>Скорость поворота</b><span>Медленнее — легче следить за деталями</span></div><label><input id="speed-input" type="range" min="120" max="800" step="10" value="${preferences.speed}" aria-label="Длительность поворота"><output id="speed-output">${preferences.speed} мс</output></label></div><label class="setting-row"><div><b>Звук поворотов</b><span>Тихий щелчок на каждый ход</span></div><input type="checkbox" id="sound-input" class="switch" ${preferences.sound ? 'checked' : ''}></label><label class="setting-row"><div><b>Буквы на наклейках</b><span>Цвет можно различать и по обозначению</span></div><input type="checkbox" id="labels-input" class="switch" ${preferences.labels ? 'checked' : ''}></label><label class="setting-row"><div><b>Без анимации поворотов</b><span>Мгновенное выполнение ходов</span></div><input type="checkbox" id="reduced-input" class="switch" ${preferences.reduced ? 'checked' : ''}></label><div class="settings-note">${icon('check')} Настройки сохраняются автоматически</div>`, 'ПОДСТРОЙ ПОД СЕБЯ');
  $('#speed-input').addEventListener('input', e => { preferences.speed = Number(e.target.value); $('#speed-output').textContent = `${preferences.speed} мс`; persist(); });
  for (const key of ['sound', 'labels', 'reduced']) $(`#${key}-input`).addEventListener('change', e => { preferences[key] = e.target.checked; if (key === 'labels') { view.setLabels(preferences.labels); drawNet(); } if (key === 'sound') sound(); persist(); });
}

function showAlgorithms() {
  modal('Формулы под рукой.', `<p>Выбери упражнение, чтобы разобрать формулу на 3D-кубике. Каждое упражнение загружает собственный начальный случай.</p><div class="library-sizes" role="group" aria-label="Размер для библиотеки">${[2, 3, 4, 5].map(n => `<button data-library-size="${n}" class="${n === state.size ? 'active' : ''}">${n}×${n}</button>`).join('')}</div><div id="algorithm-library"></div>`, 'БИБЛИОТЕКА АЛГОРИТМОВ');
  const draw = size => {
    $('#algorithm-library').innerHTML = COURSES[size].lessons.map((lesson, i) => `<button class="library-algorithm" data-library-lesson="${i}"><span>${lesson.title}${icon('arrow')}</span><code>${escape(lesson.algorithm)}</code></button>`).join('');
    $$('[data-library-lesson]').forEach(button => button.addEventListener('click', () => { if (state.busy) return; $('#dialog').close(); state.mode = 'learn'; if (state.size !== size) { state.size = size; state.layer = 'outer'; model = new CubeModel(size); } loadLesson(Number(button.dataset.libraryLesson)); }));
  };
  $$('[data-library-size]').forEach(button => button.addEventListener('click', () => { $$('[data-library-size]').forEach(b => b.classList.toggle('active', b === button)); draw(Number(button.dataset.librarySize)); }));
  draw(state.size);
}

$$('[data-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.mode)));
$$('[data-size]').forEach(button => button.addEventListener('click', () => changeSize(Number(button.dataset.size))));
$$('[data-face]').forEach(button => button.addEventListener('click', () => perform(moveForFace(button.dataset.face))));
$$('[data-view-mode]').forEach(button => button.addEventListener('click', () => { state.turnMode = button.dataset.viewMode === 'turn'; view.setDragMode(state.turnMode); $$('[data-view-mode]').forEach(b => b.classList.toggle('active', b === button)); $('#gesture-hint').innerHTML = `${icon(state.turnMode ? 'hand' : 'explore')} ${state.turnMode ? 'Смахни по наклейке для поворота' : 'Вращай, чтобы рассмотреть'}`; }));
$('#prime-toggle').addEventListener('click', () => { state.prime = !state.prime; if (state.prime) state.double = false; drawModifiers(); });
$('#double-toggle').addEventListener('click', () => { state.double = !state.double; if (state.double) state.prime = false; drawModifiers(); });
$('#layer-select').addEventListener('change', e => { state.layer = e.target.value; drawModifiers(); });
function drawModifiers() {
  $('#prime-toggle').classList.toggle('active', state.prime); $('#prime-toggle').setAttribute('aria-pressed', state.prime);
  $('#double-toggle').classList.toggle('active', state.double); $('#double-toggle').setAttribute('aria-pressed', state.double);
  $$('[data-face]').forEach(b => { $('b', b).textContent = moveForFace(b.dataset.face); $('.face-direction', b).textContent = state.double ? '↔' : state.prime ? '↶' : '↻'; });
}
$('#undo').addEventListener('click', undo); $('#redo').addEventListener('click', redo);
$('#scramble').addEventListener('click', shuffleCube);
$('#reset').addEventListener('click', () => { if (state.busy) return; if (state.mode === 'learn') loadLesson(state.lessonIndex); else { model.reset(); view.rebuild(model); state.history = []; state.redo = []; state.solution = null; state.solutionStep = 0; resetTimer(); drawCoach(); drawStatus(); } });
$('#camera-home').addEventListener('click', () => view.home());
$('#zoom-in').addEventListener('click', () => view.zoom(1)); $('#zoom-out').addEventListener('click', () => view.zoom(-1));
$('#net-toggle').addEventListener('click', () => { $('#cube-net').hidden = !$('#cube-net').hidden; $('#net-toggle').setAttribute('aria-pressed', !$('#cube-net').hidden); drawNet(); });
['help-open', 'notation-open', 'footer-help'].forEach(id => $(`#${id}`).addEventListener('click', showHelp));
$('#settings-open').addEventListener('click', showSettings); $('#algorithms-open').addEventListener('click', showAlgorithms);
$('#dialog-close').addEventListener('click', () => $('#dialog').close());
$('#dialog').addEventListener('click', e => { if (e.target === $('#dialog')) { const rect = e.target.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) e.target.close(); } });
document.addEventListener('keydown', e => {
  if ($('#dialog').open || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.altKey) return;
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); e.key.toLowerCase() === 'y' || e.shiftKey ? redo() : undo(); return; }
  if (e.ctrlKey || e.metaKey || e.repeat || state.busy) return;
  if (e.code === 'Space' && !/BUTTON|SUMMARY/.test(e.target.tagName)) { e.preventDefault(); if (state.mode === 'learn' && !complete()) perform(lessonMoves()[state.step], 'lesson'); else if (state.solution) perform(state.solution[state.solutionStep], 'solution'); }
  else if (FACES.includes(e.key.toUpperCase())) perform(moveForFace(e.key.toUpperCase(), { prime: e.shiftKey || state.prime }));
});

try {
  if (state.mode === 'learn') model.move(inverse(lessonMoves()));
  else if (Array.isArray(saved.history) && saved.history.length < 10000) { try { model.move(saved.history); state.history = [...saved.history]; } catch { model.reset(); } }
  view = new CubeView($('#cube-canvas'), model, token => perform(token));
  if (preferences.labels) view.setLabels(true);
  $('#cube-canvas').addEventListener('context-lost', () => toast('3D-контекст прерван. Обнови страницу, чтобы восстановить кубик.'));
} catch (error) {
  console.error(error);
  $('#cube-canvas').innerHTML = '<div class="webgl-error"><b>Не удалось включить 3D</b><p>Открой тренажёр в актуальном Safari, Chrome или Firefox с поддержкой WebGL 2.</p></div>';
}
drawShell(); drawModifiers();
if (!storageAvailable) { $('.local-badge').textContent = 'Сохранение недоступно в этом браузере'; }
setInterval(() => { if ($('#timer')) $('#timer').innerHTML = formatTime(elapsed()); if ($('#timer-status') && state.running) $('#timer-status').textContent = 'Сборка идёт'; }, 50);
window.addEventListener('pagehide', persist);
