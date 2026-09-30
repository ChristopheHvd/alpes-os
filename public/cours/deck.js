/* ============================================================
   Alpes IA — moteur de présentation.

   Un deck = un manifest.json + un fichier markdown par module.
   Format d'un module :

     ---
     titre: Prompting
     duree: 45
     objectif: Écrire un prompt qui tient sur plusieurs sources
     ---

     ## Titre de la slide
     type: concept

     Corps en markdown.

     ::: notes
     Ce que je dis en présentant.
     :::

     ---

     ## Slide suivante
     type: atelier
     livrable: Un prompt maître enregistré

     ---

     ## Slide en colonnes
     colonnes: 2

     Colonne de gauche.

     ::: colonne

     Colonne de droite.

   Les slides sont séparées par `---` seul sur sa ligne. `colonnes: 2` ou `3`
   répartit le corps entre les séparateurs `::: colonne` ; sans la clé, la
   slide est sur une seule colonne. `{{client.prenom}}` est remplacé par le
   profil client passé en ?client=<id>.
   ============================================================ */
'use strict';

const qs = new URLSearchParams(location.search);
const DECK = qs.get('deck') || 'claude-fondamentaux';
const CLIENT = qs.get('client') || '';
const BASE = `/content/cours/${DECK}`;

const $ = id => document.getElementById(id);
const stage = $('stage'), sheet = $('sheet'), sheetBox = $('sheet-box'), notesEl = $('notes');
const rail = $('rail'), legend = $('legend'), tip = $('tip'), laserdot = $('laserdot');

let modules = [];        // [{ id, titre, duree, objectif, slides: [...] }]
let flat = [];           // [{ m, s, mod, slide }] toutes les slides à la file
let mi = 0, si = 0;      // module / slide courants
let deck = {}, vars = {}, editing = false, laser = false;

/* ---------------------------------------------------------- markdown */

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// une source d'image relative (img/x.png) est résolue depuis le dossier du deck
const imgSrc = src => /^(https?:)?\/\//.test(src) || src.startsWith('/') ? src : `${BASE}/${src}`;

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${imgSrc(src)}" alt="${alt}">`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Rendu markdown restreint : titres h3, listes, tableaux, citations, code.
// Une seule échappatoire au HTML brut : un bloc ```svg, pour les schémas.
//
// La source est d'abord découpée en blocs — un paragraphe, une liste, un
// tableau — puis chaque bloc est rendu séparément. Le mode édition a besoin de
// savoir quel morceau de markdown a produit quel morceau de page.

const STARTER = l => /^```/.test(l.trim()) || /^\|.*\|$/.test(l.trim()) || /^#{3,4}\s+/.test(l)
  || /^\s*\*\*\*+\s*$/.test(l) || /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(l)
  || /^\s*>\s?/.test(l) || /^\s*([-*]\s+|\d+[.)]\s+)/.test(l);

function blocks(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const push = (kind, md) => out.push({ kind, md, gap: '\n' });
  const take = (from, test) => { let i = from; while (i < lines.length && test(lines[i])) i++; return i; };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    // `gap` retient si une ligne vide séparait ce bloc du suivant : réécrire un
    // bloc ne doit pas reformater le reste de la slide.
    if (!l.trim()) { if (out.length) out[out.length - 1].gap = '\n\n'; i++; continue; }
    let j;
    if (/^```/.test(l.trim())) {
      j = i + 1;
      while (j < lines.length && !/^```\s*$/.test(lines[j].trim())) j++;
      push('fence', lines.slice(i, Math.min(j + 1, lines.length)).join('\n'));
      i = j + 1; continue;
    }
    if (/^\|.*\|$/.test(l.trim())) { j = take(i, x => /^\|.*\|$/.test(x.trim())); push('table', lines.slice(i, j).join('\n')); i = j; continue; }
    if (/^#{3,4}\s+/.test(l)) { push('h', l); i++; continue; }
    if (/^\s*\*\*\*+\s*$/.test(l)) { push('hr', l); i++; continue; }
    if (/^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(l)) { push('img', l); i++; continue; }
    if (/^\s*>\s?/.test(l)) { j = take(i, x => /^\s*>\s?/.test(x)); push('quote', lines.slice(i, j).join('\n')); i = j; continue; }
    if (/^\s*([-*]\s+|\d+[.)]\s+)/.test(l)) { j = take(i, x => /^\s*([-*]\s+|\d+[.)]\s+)/.test(x)); push('list', lines.slice(i, j).join('\n')); i = j; continue; }
    j = take(i + 1, x => x.trim() && !STARTER(x));
    push('p', lines.slice(i, j).join('\n'));
    i = j;
  }
  return out;
}

// Les cellules d'une ligne de tableau ; un `\\|` reste dans sa cellule.
const cellsOf = line => line.trim().split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());

function md1(b) {
  const lines = () => esc(b.md).split('\n');
  switch (b.kind) {
    case 'fence': {
      const m = b.md.match(/^```(\w*)\n([\s\S]*?)```\s*$/);
      const [lang, code] = m ? [m[1], m[2]] : ['', b.md];
      return lang === 'svg'
        ? `<figure style="margin:0 0 1em">${code}</figure>`
        : `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
    }
    case 'table': {
      const rows = lines().map(r => r.trim());
      const cells = r => cellsOf(r).map(c => c.replace(/\\\|/g, '|'));
      return `<table><tr>${cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr>`
        + rows.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
        + '</table>';
    }
    case 'h': return `<h3>${inline(esc(b.md).replace(/^#{3,4}\s+/, ''))}</h3>`;
    case 'hr': return '<hr>';
    case 'img': {
      const m = esc(b.md).match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
      return `<figure class="shot"><img src="${imgSrc(m[2])}" alt="${m[1]}">`
        + (m[1] ? `<figcaption>${inline(m[1])}</figcaption>` : '') + '</figure>';
    }
    case 'quote':
      return `<blockquote>${inline(lines().map(l => l.replace(/^\s*&gt;\s?/, '')).join(' '))}</blockquote>`;
    case 'list': {
      let out = '', list = null;
      for (const l of lines()) {
        const ul = l.match(/^\s*[-*]\s+(.*)$/), ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
        const want = ul ? 'ul' : 'ol';
        if (list !== want) { if (list) out += `</${list}>`; out += `<${want}>`; list = want; }
        out += `<li>${inline((ul || ol)[1])}</li>`;
      }
      return out + (list ? `</${list}>` : '');
    }
    default:
      return `<p>${inline(lines().map(l => l.trim()).join(' '))}</p>`;
  }
}

// `wrap` : en édition, chaque bloc porte son index dans la source, pour savoir
// quel markdown réécrire quand on l'a modifié.
// Recompose une source à partir de ses blocs, en gardant les séparations d'origine.
const unblock = bs => bs.map((b, i) => b.md + (i < bs.length - 1 ? b.gap : '')).join('');

function md(src, wrap = false, c = 0) {
  return blocks(src).map((b, i) => wrap
    ? `<div class="blk" data-c="${c}" data-i="${i}" data-kind="${b.kind}">${md1(b)}</div>`
    : md1(b)).join('');
}

/* ---------------------------------------------------------- colonnes */

const COL_SEP = /^[ \t]*:::[ \t]*colonne[ \t]*$/m;

// Le corps découpé en autant de colonnes que la slide en déclare : ce qui
// dépasse retombe dans la dernière, ce qui manque reste vide.
function columns(slide) {
  const n = slide.colonnes > 1 ? slide.colonnes : 1;
  const cs = slide.body.split(COL_SEP).map(p => p.trim());
  if (cs.length > n) cs.splice(n - 1, cs.length, cs.slice(n - 1).filter(Boolean).join('\n\n'));
  while (cs.length < n) cs.push('');
  return cs;
}

function setColumns(slide, cs) {
  slide.body = cs.map((p, i) => (i ? '::: colonne' + (p ? `\n\n${p}` : '') : p)).join('\n\n').trim();
}

// En édition, chaque colonne finit par le bouton qui y ajoute un bloc.
function bodyHtml(slide, wrap = false, tx = disp) {
  const cs = columns(slide);
  const col = (p, c) => md(tx(p), wrap, c) + (wrap ? `<button class="addblk" data-c="${c}" title="Ajouter un bloc">＋</button>` : '');
  if (cs.length === 1) return `<div class="md">${col(cs[0], 0)}</div>`;
  return `<div class="md cols n${cs.length}">${cs.map((p, c) => `<div class="col" data-c="${c}">${col(p, c)}</div>`).join('')}</div>`;
}

/* ---------------------------------------------------------- parsing */

function interpolate(s) {
  return String(s ?? '').replace(/\{\{\s*client\.(\w+)\s*\}\}/g, (m, k) => vars[k] ?? `⟨${k}⟩`);
}

// Le modèle garde la source telle quelle : `{{client.x}}` n'est remplacé qu'au
// rendu (disp()), sinon réécrire un module y graverait le nom du client.
// Hors édition on remplace les variables client ; en édition on montre la
// source telle qu'elle est écrite, c'est elle qu'on modifie.
const disp = s => (editing ? String(s ?? '') : interpolate(s));

function parseModule(id, src) {
  src = src.replace(/\r\n/g, '\n');

  const meta = { id, titre: id, duree: 0, objectif: '', _fm: [] };
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const kv = line.match(/^(\w+)\s*:\s*(.*)$/);
      if (!kv) continue;
      meta[kv[1]] = kv[1] === 'duree' ? parseInt(kv[2], 10) || 0 : kv[2].trim();
      meta._fm.push(kv[1]);
    }
    src = src.slice(fm[0].length);
  }

  meta.slides = src.split(/\n---\n/).map(chunk => {
    const slide = { type: 'concept', titre: '', body: '', notes: '', livrable: '', colonnes: 0 };

    // les notes formateur sortent avant tout le reste
    slide.notes = (chunk.match(/^:::\s*notes\n([\s\S]*?)\n:::\s*$/m) || [, ''])[1].trim();
    chunk = chunk.replace(/^:::\s*notes\n[\s\S]*?\n:::\s*$/m, '').trim();

    const lines = chunk.split('\n');
    if (/^##\s+/.test(lines[0] || '')) slide.titre = lines.shift().replace(/^##\s+/, '').trim();
    // les clés éventuelles suivent immédiatement le titre
    while (lines.length) {
      const kv = lines[0].match(/^(type|livrable|colonnes)\s*:\s*(.*)$/);
      if (!kv) break;
      slide[kv[1]] = kv[1] === 'colonnes' ? parseInt(kv[2], 10) || 0 : kv[2].trim();
      lines.shift();
    }
    slide.body = lines.join('\n').trim();
    return slide;
  }).filter(s => s.titre || s.body);

  return meta;
}

// L'inverse exact de parseModule : c'est ce qui repart dans le fichier .md.
function serializeModule(mod) {
  const fm = mod._fm.map(k => `${k}: ${mod[k]}`).join('\n');
  const chunks = mod.slides.map(s => {
    const head = [s.titre && `## ${s.titre}`, s.type && `type: ${s.type}`, s.livrable && `livrable: ${s.livrable}`,
      s.colonnes > 1 && `colonnes: ${s.colonnes}`];
    const parts = [head.filter(Boolean).join('\n'), s.body, s.notes && `::: notes\n${s.notes}\n:::`];
    return parts.filter(Boolean).join('\n\n');
  });
  return `---\n${fm}\n---\n\n${chunks.join('\n\n---\n\n')}\n`;
}

/* ---------------------------------------------------------- rendu */

const KICKER = {
  titre: 'Module', concept: 'Concept', demo: 'Démonstration',
  atelier: 'Atelier', recap: 'À retenir', piege: 'Piège',
};

const LAYOUTS = [[1, 'Central'], [2, '2 colonnes'], [3, '3 colonnes']];

function render() {
  const mod = modules[mi], slide = mod.slides[si];
  document.title = `${disp(mod.titre)} — ${disp(slide.titre) || 'Support'}`;
  $('b-mod').textContent = disp(mod.titre);

  const kicker = slide.type === 'titre' ? `Module ${mi + 1} · ${KICKER.titre}` : KICKER[slide.type] || KICKER.concept;
  const parts = [editing
    ? `<p class="kicker"><select class="typesel">${Object.keys(KICKER).map(k => `<option value="${k}"${k === slide.type ? ' selected' : ''}>${esc(KICKER[k])}</option>`).join('')}</select>
      <select class="laysel" title="Disposition">${LAYOUTS.map(([n, label]) => `<option value="${n}"${n === columns(slide).length ? ' selected' : ''}>${label}</option>`).join('')}</select></p>`
    : `<p class="kicker">${esc(kicker)}</p>`];
  if (slide.type === 'titre' && mod.gif) {
    parts.push(`<div class="titre-row">
      <h2 data-edit="titre">${inline(esc(disp(slide.titre)))}</h2>
      <img class="mod-gif" src="${esc(mod.gif)}" alt="" loading="lazy">
    </div>`);
  } else if (slide.titre || editing) {
    parts.push(`<h2 data-edit="titre">${inline(esc(disp(slide.titre)))}</h2>`);
  }
  if (slide.body || editing) parts.push(bodyHtml(slide, editing));
  if (slide.type === 'titre' && (mod.objectif || editing)) {
    parts.push(`<div class="obj"><b>Objectif</b> <span data-edit="objectif">${esc(disp(mod.objectif))}</span>${mod.duree || editing ? ` · <span data-edit="duree">${mod.duree}</span> min` : ''}</div>`);
  }
  if (slide.livrable || editing) parts.push(`<div class="livrable"><b>Livrable</b><br><span data-edit="livrable">${inline(esc(disp(slide.livrable)))}</span></div>`);

  hideTools();
  insEl.hidden = true;
  tblEl.hidden = true;
  stage.innerHTML = `<article class="slide t-${slide.type}">${parts.join('')}</article>`;

  const idx = flat.findIndex(f => f.m === mi && f.s === si);
  $('f-count').textContent = `${idx + 1} / ${flat.length}`;
  $('f-bar').style.width = `${((idx + 1) / flat.length) * 100}%`;
  $('f-prev').disabled = idx === 0;
  $('f-next').disabled = idx === flat.length - 1;

  if (editing) bindEdit();
  renderNotes();
  renderRail();
  if (sheet.classList.contains('on')) openSheet(sheetMode);
  history.replaceState(null, '', `?${qs}#${mod.id}/${si}`);
}

// arborescence des modules ; le module courant montre ses slides
function renderRail() {
  rail.innerHTML = `<div class="rt">${esc(deck.titre || 'Sommaire')}</div>`
    + modules.map((m, i) => {
      const state = i < mi ? 'done' : i === mi ? 'cur' : '';
      let row = `<button class="m ${state}" data-m="${i}">
        <span class="n">${String(i + 1).padStart(2, '0')}</span>
        <span class="t">${esc(disp(m.titre))}</span>
        <span class="d">${m.slides.length}</span>
      </button>`;
      if (i === mi) row += m.slides.map((s, j) => `<button class="sl ${j === si ? 'cur' : ''}" data-m="${i}" data-s="${j}">
        <span class="b">${j === si ? '▸' : ''}</span>
        <span class="st">${esc(disp(s.titre) || KICKER[s.type] || '—')}</span>
      </button>`).join('');
      return row;
    }).join('');
  const here = rail.querySelector('.sl.cur') || rail.querySelector('.m.cur');
  if (here) here.scrollIntoView({ block: 'nearest' });
}

function buildLegend() {
  legend.innerHTML = `<h4>Raccourcis</h4>
    <dl>
      <dt><kbd>→</kbd> <kbd>espace</kbd></dt><dd>Slide suivante</dd>
      <dt><kbd>←</kbd></dt><dd>Slide précédente</dd>
      <dt><kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Module précédent / suivant</dd>
      <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Aller au module</dd>
      <dt><kbd>S</kbd></dt><dd>Épingler le sommaire</dd>
      <dt><kbd>Échap</kbd></dt><dd>Vue d'ensemble du module</dd>
      <dt><kbd>N</kbd></dt><dd>Notes formateur</dd>
      <dt><kbd>T</kbd></dt><dd>Chrono du module</dd>
      <dt><kbd>F</kbd></dt><dd>Plein écran</dd>
      <dt><kbd>P</kbd></dt><dd>Version imprimable</dd>
      <dt><kbd>E</kbd></dt><dd>Mode édition</dd>
      <dt><kbd>L</kbd></dt><dd>Pointeur laser</dd>
      <dt><kbd>?</kbd></dt><dd>Épingler cette légende</dd>
    </dl>
    <p class="pin">Épinglé, le panneau reste affiché ; sinon il s'efface quand la souris s'arrête.</p>`;
}

function renderNotes() {
  const slide = modules[mi].slides[si];
  if (editing) {
    $('n-body').innerHTML = '<textarea class="srcbox" id="n-edit"></textarea>';
    const ta = $('n-edit');
    ta.value = slide.notes;
    ta.onblur = () => { const v = ta.value.trim(); if (v !== slide.notes) { slide.notes = v; touch(mi); } };
  } else {
    $('n-body').innerHTML = slide.notes
      ? md(disp(slide.notes))
      : '<p class="empty">Pas de note pour cette slide.</p>';
  }
  const nxt = flat[flat.findIndex(f => f.m === mi && f.s === si) + 1];
  $('n-peek').innerHTML = nxt
    ? `<b>Ensuite</b><span>${esc(disp(nxt.slide.titre) || '—')}</span>`
    : '<b>Ensuite</b><span>Fin du support.</span>';
}

/* ---------------------------------------------------------- navigation */

const reflat = () => { flat = modules.flatMap((mod, m) => mod.slides.map((slide, s) => ({ m, s, mod, slide }))); };

function goto(m, s) {
  if (m < 0 || m >= modules.length) return;
  const mod = modules[m];
  if (s < 0 || s >= mod.slides.length) return;
  if (m !== mi) resetTimer(mod.duree);
  mi = m; si = s;
  render();
}

function step(d) {
  const idx = flat.findIndex(f => f.m === mi && f.s === si) + d;
  const t = flat[idx];
  if (t) goto(t.m, t.s);
}

/* ---------------------------------------------------------- chrono */

let tStart = 0, tRun = false, tTick = null, tBudget = 0;

function resetTimer(duree) {
  tBudget = (duree || 0) * 60;
  tStart = 0; tRun = false;
  clearInterval(tTick); tTick = null;
  paintTimer();
}
function toggleTimer() {
  if (tRun) { clearInterval(tTick); tTick = null; tRun = false; }
  else { tStart = Date.now() - (tStart ? Date.now() - tStart : 0); tStart = Date.now() - elapsed() * 1000; tRun = true; tTick = setInterval(paintTimer, 1000); }
  paintTimer();
}
let held = 0;
function elapsed() { return tRun ? Math.floor((Date.now() - tStart) / 1000) : held; }
function paintTimer() {
  if (tRun) held = Math.floor((Date.now() - tStart) / 1000);
  const e = held, m = String(Math.floor(e / 60)).padStart(2, '0'), s = String(e % 60).padStart(2, '0');
  const el = $('timer');
  el.textContent = tBudget ? `${m}:${s} / ${tBudget / 60}′` : `${m}:${s}`;
  el.classList.toggle('run', tRun);
  el.classList.toggle('over', !!tBudget && e > tBudget);
}

/* ---------------------------------------------------------- panneaux */

let sheetMode = null;

function openSheet(mode) {
  sheetMode = mode;
  if (mode === 'grid') {
    const mod = modules[mi];
    sheetBox.innerHTML = `<h3>${esc(disp(mod.titre))}</h3>
      <p class="sub">${mod.slides.length} slides${mod.duree ? ` · ${mod.duree} min` : ''}</p>
      <div class="grid">${mod.slides.map((s, i) => `
        <div class="cell">
          <button data-s="${i}" data-t="${s.type}" class="${i === si ? 'on' : ''}">
            <span class="n">${String(i + 1).padStart(2, '0')}</span>
            <span class="tt">${esc(disp(s.titre) || '—')}</span>
            <span class="ty">${esc(KICKER[s.type] || s.type)}</span>
          </button>
          ${editing ? `<button class="del" data-del="${i}" title="Supprimer cette slide">×</button>` : ''}
        </div>`).join('')}
        ${editing ? '<div class="cell add"><button class="new">＋ Nouvelle slide</button></div>' : ''}</div>`;
    sheetBox.querySelectorAll('.grid button[data-s]').forEach(b => b.onclick = () => { goto(mi, +b.dataset.s); closeSheet(); });
    sheetBox.querySelectorAll('.grid button.del').forEach(b => b.onclick = e => { e.stopPropagation(); deleteSlide(+b.dataset.del); });
    const add = sheetBox.querySelector('.grid button.new');
    if (add) add.onclick = () => openSheet('new');
    if (editing) {
      sheetBox.querySelectorAll('.grid .cell:not(.add)').forEach((cell, i) => {
        cell.draggable = true;
        cell.ondragstart = e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i); cell.classList.add('dragging'); };
        cell.ondragend = () => cell.classList.remove('dragging');
        cell.ondragover = e => { e.preventDefault(); cell.classList.add('over'); };
        cell.ondragleave = () => cell.classList.remove('over');
        cell.ondrop = e => {
          e.preventDefault();
          cell.classList.remove('over');
          reorderSlide(+e.dataTransfer.getData('text/plain'), i);
        };
      });
    }
  } else if (mode === 'new') {
    const cur = modules[mi].slides[si];
    sheetBox.innerHTML = `<h3>Nouvelle slide</h3>
      <p class="sub">Insérée après « ${esc(disp(cur.titre) || KICKER[cur.type] || `slide ${si + 1}`)} »</p>
      <div class="layouts">${LAYOUTS.map(([n, label]) => `<button data-n="${n}">
        <span class="lay n${n}">${'<i></i>'.repeat(n)}</span>${label}
      </button>`).join('')}</div>`;
    sheetBox.querySelectorAll('.layouts button').forEach(b => b.onclick = () => addSlide(+b.dataset.n));
  }
  sheet.classList.add('on');
}
function closeSheet() { sheet.classList.remove('on'); sheetMode = null; }
function toggleSheet(mode) { sheetMode === mode ? closeSheet() : openSheet(mode); }

// Supprimer une slide du module courant depuis la vue d'ensemble : seulement
// en mode édition (openSheet ne pose le bouton que dans ce cas). Un module
// garde toujours au moins une slide.
function deleteSlide(i) {
  if (!editing) return;
  const mod = modules[mi];
  if (mod.slides.length <= 1) { say('impossible de supprimer la dernière slide du module', true); return; }
  const titre = disp(mod.slides[i].titre) || KICKER[mod.slides[i].type] || `slide ${i + 1}`;
  if (!confirm(`Supprimer « ${titre} » ?`)) return;
  mod.slides.splice(i, 1);
  if (i <= si) si--;
  si = Math.max(0, Math.min(si, mod.slides.length - 1));
  reflat();
  touch(mi);
  render(); // remet la slide et le rail à jour, et rouvre la grille puisque sheet reste .on
}

// Nouvelle slide, insérée après la courante, dans la disposition choisie. Elle
// porte un titre d'emblée : une slide sans titre ni corps ne se relit pas.
function addSlide(n) {
  if (!editing) return;
  const mod = modules[mi];
  const slide = { type: 'concept', titre: 'Nouvelle slide', body: '', notes: '', livrable: '', colonnes: n > 1 ? n : 0 };
  setColumns(slide, columns(slide));
  mod.slides.splice(si + 1, 0, slide);
  reflat();
  touch(mi);
  closeSheet();
  goto(mi, si + 1);
  const h = stage.querySelector('h2[data-edit="titre"]');
  h.focus();
  getSelection().selectAllChildren(h);
}

// Réordonner une slide depuis la vue d'ensemble (glisser-déposer, mode édition
// seulement). Pas de notion de position à gérer côté fichier : serializeModule
// écrit déjà mod.slides dans son ordre courant.
function reorderSlide(from, to) {
  if (!editing || from === to) return;
  const mod = modules[mi];
  const current = mod.slides[si];
  const [moved] = mod.slides.splice(from, 1);
  mod.slides.splice(to, 0, moved);
  si = mod.slides.indexOf(current);
  reflat();
  touch(mi);
  render();
}

/* ---------------------------------------------------------- handout */

function buildPrint() {
  $('print').innerHTML = `<div class="ph"><b>${esc(deck.titre || 'Support de formation')}</b>
    <span>Alpes IA — ${esc(deck.soustitre || '')}${vars.nom ? ` · ${esc(vars.nom)}` : ''}</span></div>`
    + modules.map(m => `<section class="pm"><h2>${esc(interpolate(m.titre))}</h2>
        <p class="mo">${esc(interpolate(m.objectif))}${m.duree ? ` — ${m.duree} min` : ''}</p>
        ${m.slides.filter(s => s.type !== 'titre').map(s => `<div class="ps">
          <h4>${esc(interpolate(s.titre))}</h4>
          ${bodyHtml(s, false, interpolate)}
          ${s.livrable ? `<div class="nt">Livrable : ${esc(interpolate(s.livrable))}</div>` : ''}
          ${s.notes ? `<div class="nt">${md(interpolate(s.notes))}</div>` : ''}
        </div>`).join('')}
      </section>`).join('');
}

/* ---------------------------------------------------------- thème + chrome */

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('theme', t); } catch (e) {}
}
setTheme((() => { try { return localStorage.getItem('theme'); } catch (e) { return null; } })()
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

// en projection, le chrome s'efface quand on ne touche à rien
let idle = null, overChrome = false;
const chrome = () => [$('bar'), $('foot'), rail, legend];
function wake() {
  for (const el of chrome()) el.classList.remove('hide');
  clearTimeout(idle);
  idle = setTimeout(sleep, 3000);
}
function sleep() {
  if (editing) return;
  if (overChrome || sheet.classList.contains('on') || notesEl.classList.contains('on')) return;
  for (const el of chrome()) {
    if ((el === rail || el === legend) && el.classList.contains('pin')) continue;
    el.classList.add('hide');
  }
}
addEventListener('mousemove', wake);
for (const el of [rail, legend]) {
  el.addEventListener('mouseenter', () => { overChrome = true; });
  el.addEventListener('mouseleave', () => { overChrome = false; wake(); });
}
// S / ? : épinglent le panneau (il ne s'efface plus tant qu'il est épinglé)
function pin(el) { el.classList.toggle('pin'); el.classList.remove('hide'); $(el === rail ? 'b-toc' : 'b-help').classList.toggle('on', el.classList.contains('pin')); wake(); }

/* ---------------------------------------------------------- events */

$('f-next').onclick = () => step(1);
$('f-prev').onclick = () => step(-1);
const trackTarget = e => {
  const r = $('f-track').getBoundingClientRect();
  const i = Math.max(0, Math.min(flat.length - 1, Math.floor((e.clientX - r.left) / r.width * flat.length)));
  return { r, f: flat[i] };
};
$('f-track').onclick = e => { const { f } = trackTarget(e); if (f) goto(f.m, f.s); };
$('f-track').onmousemove = e => {
  const { r, f } = trackTarget(e);
  tip.textContent = `${disp(f.mod.titre)} · ${disp(f.slide.titre) || KICKER[f.slide.type] || '—'}`;
  tip.style.left = e.clientX + 'px';
  tip.style.top = (r.top - 8) + 'px';
  tip.hidden = false;
};
$('f-track').onmouseleave = () => { tip.hidden = true; };
rail.onclick = e => {
  const b = e.target.closest('button');
  if (b) goto(+b.dataset.m, b.dataset.s ? +b.dataset.s : 0);
};
$('b-notes').onclick = () => { notesEl.classList.toggle('on'); $('b-notes').classList.toggle('on'); };
$('n-close').onclick = () => { notesEl.classList.remove('on'); $('b-notes').classList.remove('on'); };
$('b-toc').onclick = () => pin(rail);
$('b-help').onclick = () => pin(legend);
$('b-theme').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
$('timer').onclick = toggleTimer;
sheet.onclick = e => { if (e.target === sheet) closeSheet(); };

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  // en train d'écrire : les flèches et les chiffres appartiennent au texte
  if (e.target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
    if (k === 'Escape') { e.target.blur(); e.preventDefault(); }
    return;
  }
  if (k === 'Escape') { sheet.classList.contains('on') ? closeSheet() : toggleSheet('grid'); return e.preventDefault(); }
  if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { step(1); return e.preventDefault(); }
  if (k === 'ArrowLeft' || k === 'PageUp') { step(-1); return e.preventDefault(); }
  if (k === 'ArrowDown') { goto(mi + 1, 0); return e.preventDefault(); }
  if (k === 'ArrowUp') { goto(mi - 1, 0); return e.preventDefault(); }
  if (k === 'Home') { goto(0, 0); return e.preventDefault(); }
  if (k === 'End') { const t = flat[flat.length - 1]; goto(t.m, t.s); return e.preventDefault(); }
  if (/^[1-9]$/.test(k)) { goto(+k - 1, 0); return e.preventDefault(); }
  const l = k.toLowerCase();
  if (l === 's') { pin(rail); return e.preventDefault(); }
  if (l === 'n') { $('b-notes').click(); return e.preventDefault(); }
  if (l === 't') { toggleTimer(); return e.preventDefault(); }
  if (l === 'p') { print(); return e.preventDefault(); }
  if (l === 'e') { setEdit(!editing); return e.preventDefault(); }
  if (l === 'l') { setLaser(!laser); return e.preventDefault(); }
  if (l === 'f') {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    return e.preventDefault();
  }
  if (k === '?') { pin(legend); return e.preventDefault(); }
  wake();
});

/* ---------------------------------------------------------- édition */

// Le support est modifiable en place : au clic, un bloc de la slide redevient
// éditable ; en le quittant il repasse en markdown et le module entier est
// réécrit dans content/cours/. Le fichier reste la source de vérité, l'écran
// n'est qu'une autre façon d'y écrire.

const fmtEl = $('fmt'), saveEl = $('b-save');
const pending = new Set(), busy = new Set();
let saveTimer = null;

const EDITABLE = { p: 1, list: 1, h: 1, quote: 1 };

function setEdit(on) {
  if (on && laser) setLaser(false);
  editing = on;
  document.body.classList.toggle('editing', on);
  $('b-edit').classList.toggle('on', on);
  hideFmt();
  say(on ? 'prêt' : '');
  render();
  if (on) wake();
}

// Pointeur laser : remplace le curseur système par un point rouge qui suit la
// souris, pour pointer à l'écran en présentation. Coupé automatiquement en
// entrant en édition, qui a besoin d'un vrai curseur pour sélectionner du texte.
function setLaser(on) {
  laser = on;
  document.body.classList.toggle('laser', on);
  $('b-laser').classList.toggle('on', on);
}
addEventListener('mousemove', e => {
  laserdot.style.left = e.clientX + 'px';
  laserdot.style.top = e.clientY + 'px';
});
$('b-laser').onclick = () => setLaser(!laser);

function say(msg, bad = false) {
  saveEl.textContent = msg;
  saveEl.classList.toggle('bad', bad);
}

function touch(m) {
  pending.add(m);
  say('modifié…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
}

// Une écriture à la fois par module ; celles qui arrivent pendant sont fondues
// dans la suivante, puisqu'on renvoie de toute façon le fichier entier.
async function saveNow() {
  for (const m of [...pending]) {
    const mod = modules[m];
    if (busy.has(m) || mod._stale) continue;
    pending.delete(m); busy.add(m);
    try {
      const r = await fetch(`/api/cours/${DECK}/${mod._file}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ src: serializeModule(mod), lastModified: mod._lm }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { mod._stale = true; say(`« ${mod.titre} » a changé sur le disque — recharge la page`, true); }
      else if (!r.ok) say(j.error || `erreur ${r.status}`, true);
      else { mod._lm = j.lastModified; say(`enregistré ${new Date().toTimeString().slice(0, 5)}`); }
    } catch (e) { say(e.message, true); }
    finally { busy.delete(m); }
  }
}

/* --- du HTML modifié vers le markdown --- */

// On ne reconnaît que ce que inline() sait produire ; tout le reste est aplati
// en texte, ce qui rend un collage depuis Word inoffensif.
// Le navigateur laisse volontiers l'espace *à l'intérieur* du gras quand on
// réécrit un mot. `**x** ` et `** x**` ne veulent pas dire la même chose en
// markdown : l'espace doit ressortir des marqueurs, pas disparaître.
function mark(inner, m, fn = t => m + t + m) {
  const [, before, text, after] = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return text ? before + fn(text) + after : inner;
}

function walk(n) {
  if (n.nodeType === 3) return n.nodeValue.replace(/\u00a0/g, ' ');
  if (n.nodeType !== 1) return '';
  const inner = [...n.childNodes].map(walk).join('');
  switch (n.tagName) {
    case 'BR': return ' ';
    case 'STRONG': case 'B': return mark(inner, '**');
    case 'EM': case 'I': return mark(inner, '*');
    case 'CODE': return mark(inner, '`');
    case 'A': return mark(inner, '', t => `[${t}](${n.getAttribute('href') || ''})`);
    case 'IMG': return `![${n.getAttribute('alt') || ''}](${n.getAttribute('src') || ''})`;
    default: return inner;
  }
}

const clean = s => s.replace(/[ \t]+/g, ' ').trim();

function elToMd(el) {
  const t = el.tagName;
  if (t === 'UL' || t === 'OL') {
    return [...el.children].map((li, i) => (t === 'OL' ? `${i + 1}. ` : '- ') + clean(walk(li))).join('\n');
  }
  if (t === 'H3' || t === 'H4') return `### ${clean(walk(el))}`;
  if (t === 'BLOCKQUOTE') return `> ${clean(walk(el))}`;
  return clean(walk(el));
}

// Le navigateur crée ses propres <div> quand on appuie sur Entrée : un bloc
// édité peut donc en produire plusieurs.
function editedMd(host) {
  const out = [], loose = [];
  const dump = () => { const t = clean(loose.join('')); loose.length = 0; if (t) out.push(t); };
  for (const n of host.childNodes) {
    if (n.nodeType === 1 && /^(UL|OL|H3|H4|BLOCKQUOTE|DIV|P)$/.test(n.tagName)) {
      dump();
      const m = elToMd(n);
      if (m.trim()) out.push(m);
    } else loose.push(walk(n));
  }
  dump();
  return out.join('\n\n');
}

/* --- accrochage sur la slide rendue --- */

function bindEdit() {
  const mod = modules[mi], slide = mod.slides[si];

  const write = (box, key, v) => { if (box[key] !== v) { box[key] = v; touch(mi); render(); } };

  for (const el of stage.querySelectorAll('[data-edit]')) {
    el.contentEditable = 'true';
    el.addEventListener('blur', () => {
      const k = el.dataset.edit, v = clean(walk(el));
      if (k === 'duree') write(mod, k, parseInt(v, 10) || 0);
      else write(k === 'objectif' ? mod : slide, k, v);
    });
  }

  const sel = stage.querySelector('.typesel');
  if (sel) sel.onchange = () => write(slide, 'type', sel.value);

  // moins de colonnes : columns() replie celles qu'on retire dans la dernière gardée
  const lay = stage.querySelector('.laysel');
  if (lay) lay.onchange = () => {
    slide.colonnes = +lay.value;
    setColumns(slide, columns(slide));
    touch(mi);
    render();
  };

  for (const el of stage.querySelectorAll('.blk')) {
    if (el.dataset.kind === 'table') { bindTable(el, slide); continue; }
    if (!EDITABLE[el.dataset.kind]) { el.classList.add('src'); el.onclick = () => srcEdit(el, slide); continue; }
    el.contentEditable = 'true';
    el.addEventListener('blur', () => commit(el, slide));
  }

  // mousedown : le bloc en cours d'écriture garde le focus, sinon il se réenregistre et le clic se perd
  for (const b of stage.querySelectorAll('.addblk')) b.onmousedown = e => { e.preventDefault(); openIns(b); };
}

// Un paragraphe écrit sur deux lignes est rendu sur une seule : le quitter sans
// l'avoir touché ne doit pas replier la source pour autant.
const same = a => a.replace(/\s+/g, ' ').trim();

// Réécrit une colonne de la slide à travers ses blocs. `fn` modifie le tableau
// sur place ; s'il renvoie false, rien n'a changé.
function editBlocks(slide, c, fn) {
  const cs = columns(slide), bs = blocks(cs[c]);
  if (fn(bs) === false) return false;
  cs[c] = unblock(bs);
  setColumns(slide, cs);
  touch(mi);
  return true;
}

// Deux paragraphes séparés d'un simple retour se relisent comme un seul : un
// bloc retiré laisse une ligne vide entre ses voisins.
function drop(bs, i) {
  bs.splice(i, 1);
  if (bs[i - 1]) bs[i - 1].gap = '\n\n';
}

function commit(el, slide) {
  const i = +el.dataset.i, now = editedMd(el);
  const changed = editBlocks(slide, +el.dataset.c, bs => {
    if (!bs[i] || same(now) === same(bs[i].md)) return false;
    if (now) bs[i] = { ...bs[i], md: now }; else drop(bs, i);
  });
  if (changed) render();
}

// Tableaux, schémas ```svg, blocs de code : leur markdown se corrige mieux à la
// main que dans un contenteditable.
function srcEdit(el, slide) {
  const c = +el.dataset.c, i = +el.dataset.i, was = blocks(columns(slide)[c])[i].md;
  const ta = document.createElement('textarea');
  ta.className = 'srcbox';
  ta.value = was;
  ta.rows = Math.min(24, was.split('\n').length + 1);
  el.replaceWith(ta);
  ta.focus();
  ta.onblur = () => {
    const v = ta.value.trim();
    if (v !== was) editBlocks(slide, c, bs => { if (v) bs[i] = { ...bs[i], md: v }; else drop(bs, i); });
    render();
  };
}

/* --- ajouter un bloc --- */

const insEl = $('insmenu');

const NEW_BLOCKS = [
  ['Sous-titre', c => insertBlock(c, '### Sous-titre')],
  ['Texte', c => insertBlock(c, 'Texte')],
  ['Liste', c => insertBlock(c, '- Premier point\n- Deuxième point')],
  ['Tableau', c => insertBlock(c, '| Colonne 1 | Colonne 2 |\n| --- | --- |\n| … | … |')],
];

function openIns(btn) {
  const c = +btn.dataset.c, r = btn.getBoundingClientRect();
  insEl.innerHTML = NEW_BLOCKS.map(([label], j) => `<button data-j="${j}">${label}</button>`).join('');
  insEl.hidden = false;
  insEl.style.left = `${r.left}px`;
  // près du bas de l'écran, le menu s'ouvre vers le haut
  insEl.style.top = `${r.bottom + 4 + insEl.offsetHeight > innerHeight ? r.top - 4 - insEl.offsetHeight : r.bottom + 4}px`;
  insEl.onmousedown = e => {
    e.preventDefault();
    const b = e.target.closest('button');
    if (!b) return;
    insEl.hidden = true;
    NEW_BLOCKS[+b.dataset.j][1](c);
  };
}

addEventListener('mousedown', e => { if (!e.target.closest?.('.insmenu, .addblk')) insEl.hidden = true; }, true);

// Le bloc arrive en fin de colonne, son texte sélectionné : on tape pour le remplacer.
function insertBlock(c, src) {
  const slide = modules[mi].slides[si];
  if (stage.contains(document.activeElement)) document.activeElement.blur();
  let at = 0;
  editBlocks(slide, c, bs => {
    at = bs.length;
    if (bs[at - 1]) bs[at - 1].gap = '\n\n';
    bs.push({ kind: '', md: src, gap: '\n\n' });
  });
  render();
  const el = stage.querySelector(`.blk[data-c="${c}"][data-i="${at}"]`);
  const cell = el?.querySelector('th[contenteditable="true"]');
  if (cell) return focusCell(cell);
  if (!el?.isContentEditable) return;
  el.focus();
  getSelection().selectAllChildren(el.querySelector('li, h3, p') || el);
}

/* --- monter, descendre, retirer un bloc --- */

// Une seule barre, posée sur le bloc (ou le titre) survolé.
const toolsEl = $('blktools');
let toolsFor = null;

function showTools(el) {
  toolsFor = el;
  toolsEl.classList.toggle('title', !!el.dataset.edit);
  toolsEl.hidden = false;
  const r = el.getBoundingClientRect();
  toolsEl.style.left = `${r.right}px`;
  toolsEl.style.top = `${r.top}px`;
}
function hideTools() { toolsEl.hidden = true; toolsFor = null; }

stage.addEventListener('mouseover', e => {
  if (!editing) return;
  const el = e.target.closest('.blk, h2[data-edit]');
  if (!el) hideTools();
  else if (el !== toolsFor) showTools(el);
});
stage.addEventListener('scroll', hideTools, true);

toolsEl.onmousedown = e => {
  e.preventDefault();
  const b = e.target.closest('button');
  if (b && toolsFor) blockAction(toolsFor, b.dataset.a);
};

function blockAction(el, act) {
  const slide = modules[mi].slides[si];
  // un bloc en cours d'écriture s'enregistre d'abord, tant que ses index sont justes
  if (el.contains(document.activeElement)) document.activeElement.blur();
  if (el.dataset.edit) { slide.titre = ''; touch(mi); render(); return; }
  const c = +el.dataset.c, i = +el.dataset.i, to = act === 'up' ? i - 1 : i + 1;
  const done = editBlocks(slide, c, bs => {
    if (!bs[i]) return false;
    if (act === 'del') return drop(bs, i);
    if (!bs[to]) return false;
    bs.splice(to, 0, bs.splice(i, 1)[0]);
    const lo = Math.min(i, to);
    for (const x of [bs[lo - 1], bs[lo], bs[lo + 1]]) if (x) x.gap = '\n\n';
  });
  if (!done) return;
  render();
  const moved = act !== 'del' && stage.querySelector(`.blk[data-c="${c}"][data-i="${to}"]`);
  if (moved) showTools(moved);
}

/* --- tableaux --- */

// Les cellules s'éditent en place. Une cellule qu'on n'a pas touchée garde son
// markdown d'origine, et le tableau n'est réécrit que si l'une a changé.
const tblEl = $('tbltools');

function tableMd(rows, sep) {
  const n = Math.max(...rows.map(r => r.length));
  const line = cs => `| ${[...cs, ...Array(n - cs.length).fill('')].join(' | ')} |`;
  if (!sep || cellsOf(sep).length !== n) sep = line(Array(n).fill('---'));
  return [line(rows[0]), sep, ...rows.slice(1).map(line)].join('\n');
}

function tableRows(el, src) {
  const lines = src.split('\n');
  const orig = [lines[0], ...lines.slice(2)].map(cellsOf);
  return [...el.querySelectorAll('tr')].map((tr, r) => [...tr.children].map((td, k) =>
    td.innerHTML === td._html ? orig[r]?.[k] ?? '' : clean(walk(td)).replace(/(?<!\\)\|/g, '\\|')));
}

const tableSrc = (slide, el) => blocks(columns(slide)[+el.dataset.c])[+el.dataset.i].md;

function focusCell(td) {
  td.focus();
  getSelection().selectAllChildren(td);
}

function bindTable(el, slide) {
  const cells = [...el.querySelectorAll('th, td')];
  for (const td of cells) {
    td.contentEditable = 'true';
    td._html = td.innerHTML;
    // Entrée et Tab passent à la cellule suivante, son contenu sélectionné ; Maj+Tab revient
    td.onkeydown = e => {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      const next = cells[cells.indexOf(td) + (e.key === 'Tab' && e.shiftKey ? -1 : 1)];
      if (!next && e.key === 'Tab') return;
      e.preventDefault();
      next ? focusCell(next) : td.blur();
    };
  }
  el.addEventListener('focusin', () => {
    const r = el.getBoundingClientRect();
    tblEl.hidden = false;
    tblEl.style.left = `${r.left}px`;
    tblEl.style.top = `${r.top}px`;
  });
  el.addEventListener('focusout', e => {
    if (el.contains(e.relatedTarget) || el._done) return;
    tblEl.hidden = true;
    if (cells.some(td => td.innerHTML !== td._html)) writeTable(el, slide, tableRows(el, tableSrc(slide, el)));
  });
}

// `at` : la cellule [ligne, colonne] où remettre le curseur une fois le tableau redessiné.
function writeTable(el, slide, rows, at) {
  const c = +el.dataset.c, i = +el.dataset.i;
  el._done = true; // le redessin retire la cellule active : son focusout n'a plus rien à écrire
  editBlocks(slide, c, bs => {
    const md = tableMd(rows, bs[i].md.split('\n')[1]);
    if (md === bs[i].md) return false;
    bs[i] = { ...bs[i], md };
  });
  render();
  const t = stage.querySelector(`.blk[data-c="${c}"][data-i="${i}"]`);
  const td = at && t?.querySelectorAll('tr')[at[0]]?.children[at[1]];
  if (td) focusCell(td);
  return t;
}

tblEl.onmousedown = e => {
  e.preventDefault();
  const b = e.target.closest('button'), td = document.activeElement?.closest?.('th, td');
  const el = td?.closest('.blk');
  if (b && el) tableOp(el, td, b.dataset.op);
};

function tableOp(el, td, op) {
  const slide = modules[mi].slides[si], rows = tableRows(el, tableSrc(slide, el));
  const r = [...el.querySelectorAll('tr')].indexOf(td.parentElement), k = [...td.parentElement.children].indexOf(td);
  const n = rows[0].length;
  let at = [r, k];
  if (op === 'row+') { rows.splice(r + 1, 0, Array(n).fill('')); at = [r + 1, k]; }
  else if (op === 'col+') { rows.forEach(row => row.splice(k + 1, 0, '')); at = [r, k + 1]; }
  else if (op === 'row-') {
    if (r === 0) return say("la ligne d'en-tête ne se retire pas", true);
    rows.splice(r, 1);
    at = [Math.min(r, rows.length - 1), k];
  } else if (op === 'col-') {
    if (n === 1) return say('un tableau garde au moins une colonne', true);
    rows.forEach(row => row.splice(k, 1));
    at = [r, Math.min(k, n - 2)];
  } else if (op === 'src') return srcEdit(writeTable(el, slide, rows), slide);
  writeTable(el, slide, rows, at);
}

/* --- barre de mise en forme --- */

const CMDS = [
  ['B', 'Gras', () => document.execCommand('bold')],
  ['I', 'Italique', () => document.execCommand('italic')],
  ['`', 'Code', () => wrapTag('code')],
  ['↗', 'Lien', () => { const u = prompt('Adresse du lien'); if (u) document.execCommand('createLink', false, u); }],
  ['•', 'Liste à puces', () => document.execCommand('insertUnorderedList')],
  ['1.', 'Liste numérotée', () => document.execCommand('insertOrderedList')],
  ['H', 'Sous-titre', () => document.execCommand('formatBlock', false, 'h3')],
];

function wrapTag(tag) {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0), n = document.createElement(tag);
  n.appendChild(r.extractContents());
  r.insertNode(n);
  s.removeAllRanges();
}

function buildFmt() {
  fmtEl.innerHTML = CMDS.map(([label, title], i) => `<button data-c="${i}" title="${title}">${label}</button>`).join('');
  // mousedown plutôt que click : sinon le bloc perd le focus avant la commande
  fmtEl.onmousedown = e => {
    const b = e.target.closest('button');
    e.preventDefault();
    if (!b) return;
    CMDS[+b.dataset.c][2]();
    const host = document.activeElement;
    if (host?.classList.contains('blk')) commit(host, modules[mi].slides[si]);
  };
}

const hideFmt = () => { fmtEl.hidden = true; };

// selectionchange ne suffit pas : un clic qui ne déplace pas le curseur n'en
// déclenche pas. Toute pression hors de la barre la referme, une vraie nouvelle
// sélection la rouvre juste après.
addEventListener('mousedown', e => { if (!e.target.closest?.('.fmt')) hideFmt(); }, true);

document.addEventListener('selectionchange', () => {
  if (!editing) return hideFmt();
  const s = getSelection();
  const node = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement;
  if (s.isCollapsed || !node?.closest('.blk[contenteditable="true"]')) return hideFmt();
  const r = s.getRangeAt(0).getBoundingClientRect();
  fmtEl.hidden = false;
  fmtEl.style.left = `${r.left + r.width / 2}px`;
  fmtEl.style.top = `${r.top}px`;
});

addEventListener('beforeunload', e => {
  if (pending.size || busy.size) { e.preventDefault(); e.returnValue = ''; }
});

$('b-edit').onclick = () => setEdit(!editing);
$('b-add').onclick = () => openSheet('new');
buildFmt();

/* ---------------------------------------------------------- démarrage */

const fetchText = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} sur ${url}`);
  return r.text();
};

// Last-Modified vient d'express.static : c'est lui qu'on renverra en écrivant,
// pour repérer qu'un terminal a touché le fichier entre temps.
const fetchModule = async file => {
  const r = await fetch(`${BASE}/${file}`);
  if (!r.ok) throw new Error(`${r.status} sur ${file}`);
  return { src: await r.text(), lm: r.headers.get('last-modified') || '' };
};

(async function init() {
  try {
    deck = JSON.parse(await fetchText(`${BASE}/manifest.json`));
    vars = { ...(deck.generique || {}) };
    if (CLIENT) {
      try { Object.assign(vars, JSON.parse(await fetchText(`${BASE}/clients/${CLIENT}.json`))); }
      catch (e) { console.warn('Profil client introuvable, on reste sur le générique.', e); }
    }
    $('b-client').textContent = vars.nom || '';

    const sources = await Promise.all(deck.modules.map(fetchModule));
    modules = deck.modules.map((f, i) => Object.assign(
      parseModule(f.replace(/\.md$/, ''), sources[i].src), { _file: f, _lm: sources[i].lm }));
    reflat();
    if (!flat.length) throw new Error('Aucune slide trouvée.');

    buildPrint();
    buildLegend();

    const [hm, hs] = decodeURIComponent(location.hash.slice(1)).split('/');
    const m = Math.max(0, modules.findIndex(x => x.id === hm));
    goto(m, Math.min(Math.max(0, parseInt(hs, 10) || 0), modules[m].slides.length - 1));
    resetTimer(modules[m].duree);
    wake();
  } catch (err) {
    stage.innerHTML = `<div class="err"><b>Support introuvable</b>
      Impossible de charger <code>${esc(BASE)}</code>.<br><code>${esc(err.message)}</code></div>`;
  }
})();
