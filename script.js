/* ===== SmartLanche SENAI — script.js ===== */
'use strict';

(function () {
  // ---------- Constantes ----------
  var KEY_DB = 'smartlanche_senai_db';
  var KEY_SESSAO = 'smartlanche_senai_sessao';
  var KEY_PROF_CURSO = 'smartlanche_senai_prof_curso';
  var RE_MATRICULA = /^\d{4,15}$/;
  var RE_QR = /^MATRICULA:(\d{4,15})$/;
  var PIX_MS = 1000; // Tempo reduzido para agilizar a fila da cantina (1 segundo)

  // ---------- Helpers ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function fmtHora(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '--:--:--' :
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  function fmtData(d) {
    return (d || new Date()).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  }
  function getIsoHoje(d) {
    var dt = d || new Date();
    var ano = dt.getFullYear();
    var mes = String(dt.getMonth() + 1).padStart(2, '0');
    var dia = String(dt.getDate()).padStart(2, '0');
    return ano + '-' + mes + '-' + dia;
  }
  function fmtDataBrSimples(isoYmd) {
    if (!isoYmd) return '';
    var partes = isoYmd.split('-');
    if (partes.length !== 3) return isoYmd;
    return partes[2] + '/' + partes[1] + '/' + partes[0];
  }

  // ---------- Banco de dados (localStorage) ----------
  function dbPadrao() {
    return {
      students: [],
      attendance: {},
      snacks: {},
      history: {},
      menu: '',
      stockTotal: 0,
      infractions: []
    };
  }

  function carregarDB() {
    try {
      var raw = localStorage.getItem(KEY_DB);
      if (!raw) return dbPadrao();
      var p = JSON.parse(raw);
      if (!isObj(p)) return dbPadrao();

      var alunos = Array.isArray(p.students) ? p.students.filter(function (s) {
        return isObj(s) && s.matricula && s.nome;
      }) : [];

      var snacks = {};
      if (isObj(p.snacks)) {
        Object.keys(p.snacks).forEach(function (m) {
          if (isObj(p.snacks[m]) && p.snacks[m].hora) snacks[m] = p.snacks[m];
        });
      }

      var att = {};
      if (isObj(p.attendance)) {
        Object.keys(p.attendance).forEach(function (m) {
          if (p.attendance[m] === 'P' || p.attendance[m] === 'F') att[m] = p.attendance[m];
        });
      }

      var hist = {};
      if (isObj(p.history)) {
        Object.keys(p.history).forEach(function (dataKey) {
          var item = p.history[dataKey];
          if (isObj(item)) {
            hist[dataKey] = {
              attendance: isObj(item.attendance) ? item.attendance : {},
              snacks: isObj(item.snacks) ? item.snacks : {},
              menu: item.menu || '',
              stockTotal: Number(item.stockTotal) || 0,
              infractions: Array.isArray(item.infractions) ? item.infractions : []
            };
          }
        });
      }

      var infra = Array.isArray(p.infractions) ? p.infractions : [];

      return {
        students: alunos,
        attendance: att,
        snacks: snacks,
        history: hist,
        menu: p.menu || '',
        stockTotal: Number(p.stockTotal) || 0,
        infractions: infra
      };
    } catch (e) {
      return dbPadrao();
    }
  }

  function salvarDB() {
    try {
      localStorage.setItem(KEY_DB, JSON.stringify(db));
      return true;
    } catch (e) {
      toast('Não foi possível salvar os dados neste navegador.', 'erro');
      return false;
    }
  }

  function carregarSessao() {
    try { return localStorage.getItem(KEY_SESSAO) || null; } catch (e) { return null; }
  }
  function salvarSessao(m) {
    try {
      if (m) localStorage.setItem(KEY_SESSAO, m); else localStorage.removeItem(KEY_SESSAO);
    } catch (e) { /* sem persistência */ }
  }

  function carregarProfCurso() {
    try { return sessionStorage.getItem(KEY_PROF_CURSO) || null; } catch (e) { return null; }
  }
  function salvarProfCurso(c) {
    try {
      if (c) sessionStorage.setItem(KEY_PROF_CURSO, c); else sessionStorage.removeItem(KEY_PROF_CURSO);
    } catch (e) { /* sem persistência */ }
  }

  var db = carregarDB();
  var sessao = carregarSessao();
  var profCursoSelecionado = carregarProfCurso();
  var viewAtual = 'aluno';
  var qrMatricula = null;
  var dataConsultaAdmin = getIsoHoje();

  // Variável para foto capturada no cadastro
  var fotoCadastroTemp = null;
  var streamCameraSelfie = null;

  // Aluno em conferência na cantina
  var alunoEmConferencia = null;
  var viaConferencia = 'qr';

  // Sincroniza hoje no histórico para garantir persistência contínua
  function sincronizarHojeNoHistorico() {
    if (!db.history) db.history = {};
    var hoje = getIsoHoje();
    db.history[hoje] = {
      attendance: Object.assign({}, db.attendance),
      snacks: Object.assign({}, db.snacks),
      menu: db.menu || '',
      stockTotal: db.stockTotal || 0,
      infractions: (db.infractions || []).slice()
    };
  }

  function acharAluno(m) {
    for (var i = 0; i < db.students.length; i++) {
      if (db.students[i].matricula === String(m)) return db.students[i];
    }
    return null;
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(texto, tipo) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = texto;
    el.className = 'toast' + (tipo ? ' ' + tipo : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function setMsg(id, texto, ok) {
    var el = $(id);
    if (!el) return;
    el.textContent = texto || '';
    el.className = 'msg' + (ok ? ' ok' : '');
  }

  // ---------- Som (bipe) ----------
  var audioCtx = null;
  function getAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* sem áudio */ }
    return audioCtx;
  }
  function bipe(sucesso) {
    var c = getAudio();
    if (!c) return;
    try {
      var notas = sucesso ? [880, 1318] : [260, 180];
      var t = c.currentTime;
      notas.forEach(function (f) {
        var o = c.createOscillator();
        var g = c.createGain();
        o.type = sucesso ? 'sine' : 'square';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g);
        g.connect(c.destination);
        o.start(t);
        o.stop(t + 0.14);
        t += 0.12;
      });
    } catch (e) { /* ignora */ }
  }
  document.addEventListener('pointerdown', getAudio);

  // ---------- Câmera / Captura de Foto do Rosto no Cadastro ----------
  async function abrirCameraSelfie() {
    var video = $('#video-selfie');
    var btnAbrir = $('#btn-abrir-camera');
    var btnCapturar = $('#btn-capturar-foto');
    if (!video) return;

    try {
      var constraints = {
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 }
        }
      };
      streamCameraSelfie = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = streamCameraSelfie;
      video.hidden = false;
      btnAbrir.hidden = true;
      btnCapturar.hidden = false;
    } catch (err) {
      toast('Não foi possível abrir a câmera frontal. Use o botão de escolher foto do aparelho.', 'erro');
    }
  }

  function pararCameraSelfie() {
    if (streamCameraSelfie) {
      streamCameraSelfie.getTracks().forEach(function (track) { track.stop(); });
      streamCameraSelfie = null;
    }
    var video = $('#video-selfie');
    if (video) video.hidden = true;
    var btnAbrir = $('#btn-abrir-camera');
    if (btnAbrir) btnAbrir.hidden = false;
    var btnCapturar = $('#btn-capturar-foto');
    if (btnCapturar) btnCapturar.hidden = true;
  }

  function capturarFotoSelfie() {
    var video = $('#video-selfie');
    var canvas = $('#canvas-selfie');
    if (!video || !canvas) return;

    var w = video.videoWidth || 320;
    var h = video.videoHeight || 320;
    var lado = Math.min(w, h);
    var sx = (w - lado) / 2;
    var sy = (h - lado) / 2;

    canvas.width = 240;
    canvas.height = 240;
    var ctx = canvas.getContext('2d');

    // Desenha invertido (espelhado natural de selfie)
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, lado, lado, 0, 0, 240, 240);

    fotoCadastroTemp = canvas.toDataURL('image/jpeg', 0.82);
    pararCameraSelfie();
    exibirPreviewFoto(fotoCadastroTemp);
  }

  function carregarFotoArquivo(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        var canvas = $('#canvas-selfie');
        var ctx = canvas.getContext('2d');
        canvas.width = 240;
        canvas.height = 240;
        var lado = Math.min(img.width, img.height);
        var sx = (img.width - lado) / 2;
        var sy = (img.height - lado) / 2;
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, 240, 240);

        fotoCadastroTemp = canvas.toDataURL('image/jpeg', 0.82);
        pararCameraSelfie();
        exibirPreviewFoto(fotoCadastroTemp);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function exibirPreviewFoto(dataUrl) {
    $('#foto-camera-container').hidden = true;
    $('#foto-preview-container').hidden = false;
    $('#img-foto-preview').src = dataUrl;
  }

  function resetarFotoCadastro() {
    fotoCadastroTemp = null;
    pararCameraSelfie();
    $('#file-foto-aluno').value = '';
    $('#foto-camera-container').hidden = false;
    $('#foto-preview-container').hidden = true;
    $('#img-foto-preview').src = '';
  }

  // ---------- Autorização de Lanche e Estoque ----------
  function autorizar(matricula, via) {
    var aluno = acharAluno(matricula);
    if (!aluno) return { ok: false, motivo: 'Aluno não cadastrado' };
    if (db.attendance[aluno.matricula] === 'F') {
      return { ok: false, aluno: aluno, motivo: 'Aluno com falta: lanche bloqueado' };
    }
    var jaRetirou = db.snacks[aluno.matricula];
    if (jaRetirou) {
      return { ok: false, aluno: aluno, motivo: 'Lanche já retirado às ' + fmtHora(jaRetirou.hora) };
    }

    // Valida estoque de lanches
    var retiradosQtd = Object.keys(db.snacks).length;
    if (db.stockTotal > 0 && retiradosQtd >= db.stockTotal) {
      return { ok: false, aluno: aluno, motivo: 'Estoque de lanches esgotado!' };
    }

    db.snacks[aluno.matricula] = { hora: new Date().toISOString(), via: via === 'manual' ? 'manual' : 'qr' };
    sincronizarHojeNoHistorico();
    if (!salvarDB()) {
      delete db.snacks[aluno.matricula];
      return { ok: false, aluno: aluno, motivo: 'Erro ao salvar. Tente novamente' };
    }
    return { ok: true, aluno: aluno, motivo: 'Retirada às ' + fmtHora(db.snacks[aluno.matricula].hora) };
  }

  function executarAutorizacao(matricula, via) {
    var r = autorizar(matricula, via);
    mostrarPix(r);
    renderTudo();
    return r;
  }

  // ---------- Efeito PIX Rápido ----------
  var pixTimer = null;
  function mostrarPix(r) {
    var el = $('#pix');
    if (!el) return;
    el.classList.toggle('erro', !r.ok);
    $('#pix-titulo').textContent = r.ok ? 'LANCHE AUTORIZADO' : 'LANCHE NEGADO';
    $('#pix-nome').textContent = r.aluno ? r.aluno.nome : '';
    $('#pix-detalhe').textContent = r.ok ? '' : r.motivo;
    el.hidden = false;
    bipe(r.ok);
    clearTimeout(pixTimer);
    pixTimer = setTimeout(function () { el.hidden = true; }, PIX_MS);
  }

  // ---------- Navegação ----------
  function irPara(view) {
    viewAtual = view;
    $$('.view').forEach(function (s) { s.hidden = (s.id !== 'view-' + view); });
    $$('.nav-btn').forEach(function (b) {
      var ativo = b.getAttribute('data-view') === view;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });

    if (view === 'cantina') iniciarScanner(); else pararScanner();
    if (view !== 'aluno') pararCameraSelfie();
    fecharModalConferencia();

    renderTudo();
    window.scrollTo(0, 0);
  }

  // ---------- Módulo do Aluno ----------
  function trocarAba(aba) {
    $$('.aba').forEach(function (b) { b.classList.toggle('ativo', b.getAttribute('data-aba') === aba); });
    $('#form-login').hidden = (aba !== 'login');
    $('#form-cadastro').hidden = (aba !== 'cadastro');
    setMsg('#msg-login', '');
    setMsg('#msg-cadastro', '');
    if (aba !== 'cadastro') resetarFotoCadastro();
  }

  function cadastrar(ev) {
    ev.preventDefault();
    var nome = $('#cad-nome').value.replace(/\s+/g, ' ').trim();
    var curso = $('#cad-curso').value.replace(/\s+/g, ' ').trim();
    var turno = $('#cad-turno').value;
    var matricula = $('#cad-matricula').value.trim();

    if (nome.length < 3) return setMsg('#msg-cadastro', 'Informe o nome completo.');
    if (curso.length < 2) return setMsg('#msg-cadastro', 'Informe o curso.');
    if (!turno) return setMsg('#msg-cadastro', 'Selecione o turno de estudo.');
    if (!RE_MATRICULA.test(matricula)) return setMsg('#msg-cadastro', 'A matrícula deve ter de 4 a 15 números.');
    if (acharAluno(matricula)) return setMsg('#msg-cadastro', 'Esta matrícula já está cadastrada. Use a aba Entrar.');
    if (!fotoCadastroTemp) return setMsg('#msg-cadastro', 'Tire ou anexe a foto do rosto do aluno para segurança antifraude.');

    db.students.push({
      matricula: matricula,
      nome: nome,
      curso: curso,
      turno: turno,
      foto: fotoCadastroTemp
    });

    if (!salvarDB()) { db.students.pop(); return; }

    sessao = matricula;
    salvarSessao(sessao);
    $('#form-cadastro').reset();
    resetarFotoCadastro();
    toast('Cadastro realizado com sucesso com foto!', 'ok');
    renderTudo();
  }

  function entrar(ev) {
    ev.preventDefault();
    var matricula = $('#login-matricula').value.trim();
    if (!RE_MATRICULA.test(matricula)) return setMsg('#msg-login', 'Digite uma matrícula válida (somente números).');
    if (!acharAluno(matricula)) return setMsg('#msg-login', 'Matrícula não encontrada. Faça o cadastro primeiro.');
    sessao = matricula;
    salvarSessao(sessao);
    $('#form-login').reset();
    setMsg('#msg-login', '');
    renderTudo();
  }

  function sair() {
    sessao = null;
    qrMatricula = null;
    salvarSessao(null);
    trocarAba('login');
    renderTudo();
  }

  function gerarQR(matricula) {
    var box = $('#qrcode');
    box.innerHTML = '';
    if (typeof QRCode === 'undefined') {
      box.innerHTML = '<p class="aviso aviso-erro">Biblioteca de QR Code não carregou. Recarregue a página.</p>';
      qrMatricula = null;
      return;
    }
    try {
      new QRCode(box, {
        text: 'MATRICULA:' + matricula,
        width: 220,
        height: 220,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      qrMatricula = matricula;
    } catch (e) {
      box.innerHTML = '<p class="aviso aviso-erro">Não foi possível gerar o QR Code.</p>';
      qrMatricula = null;
    }
  }

  function renderAluno() {
    var aluno = sessao ? acharAluno(sessao) : null;
    if (sessao && !aluno) { sessao = null; salvarSessao(null); }

    $('#aluno-auth').hidden = !!aluno;
    $('#aluno-painel').hidden = !aluno;
    if (!aluno) { qrMatricula = null; return; }

    $('#aluno-nome').textContent = aluno.nome;
    $('#aluno-curso').textContent = aluno.curso + ' • Matrícula ' + aluno.matricula;
    $('#aluno-turno').textContent = 'Turno: ' + (aluno.turno || 'Não informado');

    // Exibe foto na ficha
    var imgFoto = $('#aluno-foto-ficha');
    var placeFoto = $('#aluno-foto-placeholder');
    if (aluno.foto) {
      imgFoto.src = aluno.foto;
      imgFoto.hidden = false;
      placeFoto.hidden = true;
    } else {
      imgFoto.hidden = true;
      placeFoto.hidden = false;
    }

    var retirada = db.snacks[aluno.matricula];
    $('#aluno-ficha').hidden = !!retirada;
    $('#aluno-retirado').hidden = !retirada;

    if (retirada) {
      $('#retirado-hora').textContent = fmtHora(retirada.hora);
      $('#retirado-data').textContent = fmtData(new Date(retirada.hora));
      $('#retirado-nome').textContent = aluno.nome;
      return;
    }

    var bloqueado = db.attendance[aluno.matricula] === 'F';
    var aviso = $('#aluno-aviso');
    var codigo = $('#aluno-codigo');

    $('#qrcode').hidden = bloqueado;
    $('#aluno-bloqueado').hidden = !bloqueado;
    aviso.hidden = !bloqueado;

    if (bloqueado) {
      aviso.textContent = 'Você não está autorizado a retirar o lanche hoje: sua falta foi registrada. Procure o professor.';
      codigo.textContent = 'QR Code bloqueado';
      codigo.classList.add('bloq');
      $('#aluno-dica').textContent = 'A cantina não vai aceitar esta ficha.';
      return;
    }

    if (qrMatricula !== aluno.matricula) gerarQR(aluno.matricula);
    codigo.textContent = 'MATRICULA:' + aluno.matricula;
    codigo.classList.remove('bloq');
    $('#aluno-dica').textContent = 'Mostre esta tela para a câmera da cantina. Sua foto será conferida no leitor.';
  }

  // ---------- Módulo do Professor ----------
  function selecionarCursoProfessor(curso) {
    profCursoSelecionado = curso;
    salvarProfCurso(curso);
    renderProfessor();
  }

  function trocarCursoProfessor() {
    profCursoSelecionado = null;
    salvarProfCurso(null);
    renderProfessor();
  }

  function marcarChamada(matricula, status) {
    if (!acharAluno(matricula) || (status !== 'P' && status !== 'F')) return;
    var anterior = db.attendance[matricula];
    if (anterior === status) delete db.attendance[matricula]; else db.attendance[matricula] = status;
    sincronizarHojeNoHistorico();
    if (!salvarDB()) {
      if (anterior) db.attendance[matricula] = anterior; else delete db.attendance[matricula];
    }
    renderTudo();
  }

  function renderProfessor() {
    var telaSelecao = $('#prof-selecao-curso');
    var telaPainel = $('#prof-painel-chamada');

    if (!profCursoSelecionado) {
      telaSelecao.hidden = false;
      telaPainel.hidden = true;
      return;
    }

    telaSelecao.hidden = true;
    telaPainel.hidden = false;

    $('#prof-curso-selecionado').textContent = 'Curso: ' + profCursoSelecionado;
    $('#prof-data').textContent = fmtData();

    var turnoFiltro = $('#prof-filtro-turno') ? $('#prof-filtro-turno').value : 'todos';

    // Filtra alunos do curso e turno
    var alunosCurso = db.students.filter(function (a) {
      if (a.curso !== profCursoSelecionado) return false;
      if (turnoFiltro !== 'todos' && a.turno !== turnoFiltro) return false;
      return true;
    });

    var pres = 0, falt = 0;
    alunosCurso.forEach(function (a) {
      if (db.attendance[a.matricula] === 'P') pres++;
      if (db.attendance[a.matricula] === 'F') falt++;
    });
    $('#prof-presentes').textContent = pres;
    $('#prof-faltas').textContent = falt;
    $('#prof-pendentes').textContent = alunosCurso.length - pres - falt;

    var ul = $('#lista-professor');
    if (!alunosCurso.length) {
      ul.innerHTML = '<li class="vazio">Nenhum aluno encontrado para <strong>' + esc(profCursoSelecionado) + '</strong> (' + esc(turnoFiltro) + ').</li>';
      return;
    }

    var ordenados = alunosCurso.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    ul.innerHTML = ordenados.map(function (a) {
      var st = db.attendance[a.matricula];
      var retirou = db.snacks[a.matricula];
      var selo = retirou ? '<span class="selo selo-verde">Lanche retirado</span>'
        : (st === 'F' ? '<span class="selo selo-vermelho">Bloqueado</span>' : '');
      return '<li class="item">' +
        '<div class="item-info"><div class="item-nome">' + esc(a.nome) + '</div>' +
        '<div class="item-meta">Matrícula ' + esc(a.matricula) + ' • Turno ' + esc(a.turno || 'N/I') + '</div>' + selo + '</div>' +
        '<div class="item-acoes">' +
        '<button type="button" class="btn btn-peq btn-pres' + (st === 'P' ? ' ativo' : '') + '" data-m="' + esc(a.matricula) + '" data-s="P" aria-pressed="' + (st === 'P') + '">Presença</button>' +
        '<button type="button" class="btn btn-peq btn-falta' + (st === 'F' ? ' ativo' : '') + '" data-m="' + esc(a.matricula) + '" data-s="F" aria-pressed="' + (st === 'F') + '">Falta</button>' +
        '</div></li>';
    }).join('');
  }

  // ---------- Módulo da Cantina: Cardápio, Estoque e Verificação ----------
  function salvarCardapioEstoque() {
    var cardapio = $('#cantina-cardapio-input').value.trim();
    var estoque = parseInt($('#cantina-estoque-input').value, 10);

    db.menu = cardapio;
    db.stockTotal = isNaN(estoque) || estoque < 0 ? 0 : estoque;
    sincronizarHojeNoHistorico();
    salvarDB();
    toast('Cardápio e estoque de hoje salvos com sucesso!', 'ok');
    renderCantina();
  }

  function renderCantina() {
    // Cardápio e Estoque
    $('#cantina-disp-cardapio').textContent = db.menu || 'Nenhum informado';
    $('#cantina-disp-total').textContent = db.stockTotal || 0;

    var retirados = Object.keys(db.snacks).filter(function (m) { return acharAluno(m); });
    var entreguesQtd = retirados.length;
    $('#cantina-disp-entregues').textContent = entreguesQtd;

    var restantesEstoque = db.stockTotal > 0 ? Math.max(0, db.stockTotal - entreguesQtd) : 0;
    $('#cantina-disp-restantes').textContent = db.stockTotal > 0 ? restantesEstoque : 'Livre';

    var bloqueados = db.students.filter(function (a) { return db.attendance[a.matricula] === 'F'; }).length;
    $('#cant-retirados').textContent = retirados.length;
    $('#cant-restantes').textContent = Math.max(db.students.length - retirados.length - bloqueados, 0);
    $('#cant-bloqueados').textContent = bloqueados;

    var log = $('#log-cantina');
    if (!retirados.length) {
      log.innerHTML = '<li class="vazio">Nenhum lanche retirado hoje.</li>';
    } else {
      retirados.sort(function (a, b) { return new Date(db.snacks[b].hora) - new Date(db.snacks[a].hora); });
      log.innerHTML = retirados.slice(0, 10).map(function (m) {
        var a = acharAluno(m), s = db.snacks[m];
        return '<li class="item"><div class="item-info"><div class="item-nome">' + esc(a.nome) + '</div>' +
          '<div class="item-meta">' + esc(a.matricula) + ' • Turno ' + esc(a.turno || 'N/I') + ' • ' + (s.via === 'manual' ? 'Manual' : 'QR Code') + '</div></div>' +
          '<span class="selo selo-verde">' + esc(fmtHora(s.hora)) + '</span></li>';
      }).join('');
    }
    renderBusca();
  }

  function renderBusca() {
    var termo = norm($('#busca').value);
    var ul = $('#resultados');
    if (!termo) { ul.innerHTML = ''; return; }
    var achados = db.students.filter(function (a) {
      return norm(a.nome).indexOf(termo) !== -1 || a.matricula.indexOf(termo) !== -1;
    }).slice(0, 8);

    if (!achados.length) {
      ul.innerHTML = '<li class="vazio">Nenhum aluno encontrado.</li>';
      return;
    }
    ul.innerHTML = achados.map(function (a) {
      var retirou = db.snacks[a.matricula];
      var falta = db.attendance[a.matricula] === 'F';
      var selo = retirou ? '<span class="selo selo-verde">Retirado às ' + esc(fmtHora(retirou.hora)) + '</span>'
        : (falta ? '<span class="selo selo-vermelho">Com falta</span>' : '');
      return '<li class="item"><div class="item-info"><div class="item-nome">' + esc(a.nome) + '</div>' +
        '<div class="item-meta">' + esc(a.curso) + ' • ' + esc(a.matricula) + ' (' + esc(a.turno || 'N/I') + ')</div>' + selo + '</div>' +
        '<button type="button" class="btn btn-azul btn-peq" data-conferir="' + esc(a.matricula) + '">Conferir Foto</button></li>';
    }).join('');
  }

  // ---------- Modal de Verificação Facial Antifraude da Cantina ----------
  function abrirModalConferencia(matricula, via) {
    var aluno = acharAluno(matricula);
    if (!aluno) {
      mostrarPix({ ok: false, motivo: 'Aluno não cadastrado' });
      return;
    }

    alunoEmConferencia = aluno;
    viaConferencia = via || 'qr';

    var modal = $('#modal-conferencia');
    var img = $('#conf-foto');
    var padrao = $('#conf-foto-padrao');

    if (aluno.foto) {
      img.src = aluno.foto;
      img.hidden = false;
      padrao.hidden = true;
    } else {
      img.hidden = true;
      padrao.hidden = false;
    }

    $('#conf-nome').textContent = aluno.nome;
    $('#conf-matricula').textContent = 'Matrícula: ' + aluno.matricula;
    $('#conf-curso').textContent = 'Curso: ' + aluno.curso;
    $('#conf-turno').textContent = 'Turno: ' + (aluno.turno || 'Não informado');

    var jaRetirou = db.snacks[aluno.matricula];
    var temFalta = db.attendance[aluno.matricula] === 'F';
    var avisoLanche = $('#conf-status-lanche');
    var btnAprovar = $('#btn-conf-aprovar');

    if (temFalta) {
      avisoLanche.className = 'aviso aviso-erro conf-aviso';
      avisoLanche.textContent = 'Atenção: Aluno com falta registrada! Não pode retirar lanche.';
      btnAprovar.disabled = true;
    } else if (jaRetirou) {
      avisoLanche.className = 'aviso aviso-erro conf-aviso';
      avisoLanche.textContent = 'Atenção: Lanche já retirado hoje às ' + fmtHora(jaRetirou.hora) + '.';
      btnAprovar.disabled = true;
    } else {
      avisoLanche.className = 'aviso aviso-ok conf-aviso';
      avisoLanche.textContent = 'Liberado para lanche. Verifique o rosto antes de entregar.';
      btnAprovar.disabled = false;
    }

    modal.hidden = false;
  }

  function fecharModalConferencia() {
    var modal = $('#modal-conferencia');
    if (modal) modal.hidden = true;
    alunoEmConferencia = null;
  }

  function confirmarEntregaLancheModal() {
    if (!alunoEmConferencia) return;
    var mat = alunoEmConferencia.matricula;
    var via = viaConferencia;
    fecharModalConferencia();
    executarAutorizacao(mat, via);
  }

  function reportarFraudeModal() {
    if (!alunoEmConferencia) return;
    var aluno = alunoEmConferencia;

    var novaInfracao = {
      id: Date.now(),
      matricula: aluno.matricula,
      alunoNome: aluno.nome,
      curso: aluno.curso,
      turno: aluno.turno || 'N/I',
      hora: new Date().toISOString()
    };

    if (!Array.isArray(db.infractions)) db.infractions = [];
    db.infractions.unshift(novaInfracao);
    sincronizarHojeNoHistorico();
    salvarDB();

    fecharModalConferencia();
    bipe(false);
    toast('🚨 Infração registrada! Notificação enviada para a Coordenação.', 'erro');
    renderTudo();
  }

  // ---------- Leitor de QR Code ----------
  var scanner = null;
  var scannerAtivo = false;
  var iniciando = false;
  var bloqueioAte = 0;

  function statusLeitor(texto, tipo) {
    var el = $('#leitor-status');
    if (!el) return;
    el.textContent = texto;
    el.className = 'aviso ' + (tipo === 'erro' ? 'aviso-erro' : (tipo === 'ok' ? 'aviso-ok' : 'aviso-info'));
  }

  function onScan(texto) {
    var agora = Date.now();
    if (agora < bloqueioAte) return;
    bloqueioAte = agora + PIX_MS + 200;
    var m = RE_QR.exec(String(texto || '').trim());
    if (!m) {
      mostrarPix({ ok: false, motivo: 'QR Code inválido' });
      return;
    }
    // Abre a conferência facial instantânea
    abrirModalConferencia(m[1], 'qr');
  }

  function configLeitor() {
    return {
      fps: 10,
      qrbox: function (w, h) {
        var lado = Math.max(Math.floor(Math.min(w, h) * 0.7), 120);
        return { width: lado, height: lado };
      }
    };
  }

  async function abrirCamera() {
    var cfg = configLeitor();
    try {
      scanner = new Html5Qrcode('leitor');
      await scanner.start({ facingMode: 'environment' }, cfg, onScan, function () {});
      return;
    } catch (e1) {
      try { await scanner.clear(); } catch (_) { /* ignora */ }
      scanner = null;
    }
    var cams = await Html5Qrcode.getCameras();
    if (!cams || !cams.length) throw new Error('Nenhuma câmera encontrada');
    scanner = new Html5Qrcode('leitor');
    await scanner.start(cams[0].id, cfg, onScan, function () {});
  }

  async function iniciarScanner() {
    if (scannerAtivo || iniciando) return;
    if (typeof Html5Qrcode === 'undefined') {
      statusLeitor('Biblioteca do leitor não carregou. Verifique a ligação à internet.', 'erro');
      return;
    }
    iniciando = true;
    statusLeitor('Iniciando câmera...', 'info');
    try {
      await abrirCamera();
      scannerAtivo = true;
      statusLeitor('Câmera ativa. Aponte para o QR Code do aluno.', 'ok');
    } catch (err) {
      scanner = null;
      statusLeitor('Não foi possível aceder à câmara. Verifique as permissões.', 'erro');
    } finally {
      iniciando = false;
    }
    if (scannerAtivo && (viewAtual !== 'cantina' || document.hidden)) pararScanner();
  }

  async function pararScanner() {
    if (!scanner || !scannerAtivo) return;
    var s = scanner;
    scannerAtivo = false;
    scanner = null;
    try { await s.stop(); } catch (e) { /* parado */ }
    try { await s.clear(); } catch (e) { /* limpo */ }
  }

  async function reiniciarCamera() {
    await pararScanner();
    iniciarScanner();
  }

  // ---------- Exclusão de Matrícula (Coordenação) ----------
  function deletarMatricula(matricula) {
    var aluno = acharAluno(matricula);
    if (!aluno) return;

    var confirma = window.confirm(
      'Tem a certeza de que deseja cancelar a matrícula do aluno?\n\n' +
      'Nome: ' + aluno.nome + '\n' +
      'Matrícula: ' + aluno.matricula + '\n' +
      'Curso: ' + aluno.curso + '\n\n' +
      'Esta ação removerá o aluno de todos os registos do sistema.'
    );

    if (!confirma) return;

    db.students = db.students.filter(function (s) { return s.matricula !== String(matricula); });
    delete db.attendance[matricula];
    delete db.snacks[matricula];

    if (db.history) {
      Object.keys(db.history).forEach(function (dataKey) {
        if (db.history[dataKey].attendance) delete db.history[dataKey].attendance[matricula];
        if (db.history[dataKey].snacks) delete db.history[dataKey].snacks[matricula];
      });
    }

    if (sessao === String(matricula)) {
      sessao = null;
      qrMatricula = null;
      salvarSessao(null);
    }

    salvarDB();
    toast('Matrícula ' + matricula + ' cancelada com sucesso.', 'ok');
    renderTudo();
  }

  function arquivarInfracao(id) {
    if (!Array.isArray(db.infractions)) return;
    db.infractions = db.infractions.filter(function (inf) { return inf.id !== id; });
    sincronizarHojeNoHistorico();
    salvarDB();
    toast('Infração arquivada.', 'ok');
    renderAdmin();
  }

  // ---------- Módulo Admin (Coordenação, Histórico e Infrações) ----------
  function obterDadosDoDia(dataIso) {
    var hoje = getIsoHoje();
    if (dataIso === hoje) {
      return {
        attendance: db.attendance || {},
        snacks: db.snacks || {},
        infractions: db.infractions || [],
        ehHoje: true
      };
    }
    var histItem = (db.history && db.history[dataIso]) ? db.history[dataIso] : null;
    return {
      attendance: (histItem && histItem.attendance) ? histItem.attendance : {},
      snacks: (histItem && histItem.snacks) ? histItem.snacks : {},
      infractions: (histItem && histItem.infractions) ? histItem.infractions : [],
      ehHoje: false,
      temHistorico: !!histItem
    };
  }

  function renderAdmin() {
    var hoje = getIsoHoje();
    if (!dataConsultaAdmin) dataConsultaAdmin = hoje;

    var inputData = $('#adm-data-filtro');
    if (inputData && inputData.value !== dataConsultaAdmin) {
      inputData.value = dataConsultaAdmin;
    }

    var infoDia = obterDadosDoDia(dataConsultaAdmin);
    var diaAttendance = infoDia.attendance;
    var diaSnacks = infoDia.snacks;
    var diaInfractions = infoDia.infractions || [];

    // Renderiza painel de infrações
    var ulInfra = $('#lista-infracoes');
    $('#adm-qtd-infracoes').textContent = diaInfractions.length + ' alerta(s)';
    if (!diaInfractions.length) {
      ulInfra.innerHTML = '<li class="vazio">Nenhuma infração ou suspeita de fraude reportada hoje.</li>';
    } else {
      ulInfra.innerHTML = diaInfractions.map(function (inf) {
        return '<li class="item item-infracao">' +
          '<div class="item-info">' +
          '<strong class="texto-vermelho">🚨 Suspeita de fraude de QR Code</strong>' +
          '<div class="item-nome">' + esc(inf.alunoNome) + ' (Matrícula ' + esc(inf.matricula) + ')</div>' +
          '<div class="item-meta">' + esc(inf.curso) + ' • Turno ' + esc(inf.turno) + ' • Horário: ' + esc(fmtHora(inf.hora)) + '</div>' +
          '</div>' +
          (infoDia.ehHoje ? '<button type="button" class="btn btn-peq btn-contorno" data-arquivar-infra="' + inf.id + '">Resolver / Arquivar</button>' : '') +
          '</li>';
      }).join('');
    }

    // Subtítulo e banner de histórico
    var avisoHist = $('#adm-aviso-historico');
    var avisoTxt = $('#adm-aviso-texto');
    if (infoDia.ehHoje) {
      $('#adm-data').textContent = fmtData();
      avisoHist.hidden = true;
    } else {
      var partes = dataConsultaAdmin.split('-');
      var dObj = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
      $('#adm-data').textContent = 'Histórico do dia: ' + fmtData(dObj);
      avisoHist.hidden = false;
      if (!infoDia.temHistorico) {
        avisoTxt.textContent = 'Não existem registos arquivados para ' + fmtDataBrSimples(dataConsultaAdmin) + '.';
      } else {
        avisoTxt.textContent = 'A visualizar histórico arquivado de ' + fmtDataBrSimples(dataConsultaAdmin) + '.';
      }
    }

    // Atualiza botões de chip de data
    $$('#adm-atalhos .btn-chip').forEach(function (b) { b.classList.remove('ativo'); });
    if (dataConsultaAdmin === hoje) $('#btn-filtro-hoje').classList.add('ativo');

    // Estatísticas
    var comeram = 0, faltas = 0;
    db.students.forEach(function (a) {
      if (diaSnacks[a.matricula]) comeram++;
      if (diaAttendance[a.matricula] === 'F') faltas++;
    });
    $('#adm-alunos').textContent = db.students.length;
    $('#adm-retirados').textContent = comeram;
    $('#adm-faltas').textContent = faltas;
    $('#adm-pendentes').textContent = db.students.filter(function (a) {
      return !diaSnacks[a.matricula] && diaAttendance[a.matricula] !== 'F';
    }).length;

    // Filtros de situação e turno
    var filtro = $('#adm-filtro').value;
    var filtroTurno = $('#adm-filtro-turno') ? $('#adm-filtro-turno').value : 'todos';

    var lista = db.students.filter(function (a) {
      var comeu = !!diaSnacks[a.matricula];
      var falta = diaAttendance[a.matricula] === 'F';
      if (filtro === 'comeram' && !comeu) return false;
      if (filtro === 'pendentes' && (comeu || falta)) return false;
      if (filtro === 'faltas' && !falta) return false;
      if (filtroTurno !== 'todos' && a.turno !== filtroTurno) return false;
      return true;
    });

    if (filtro === 'comeram') {
      lista.sort(function (a, b) {
        var tA = diaSnacks[a.matricula] ? new Date(diaSnacks[a.matricula].hora).getTime() : 0;
        var tB = diaSnacks[b.matricula] ? new Date(diaSnacks[b.matricula].hora).getTime() : 0;
        return tA - tB;
      });
    } else {
      lista.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    }

    var corpo = $('#adm-tabela');
    if (!lista.length) {
      corpo.innerHTML = '<tr><td colspan="10" class="t-vazio">Nenhum aluno nesta lista para os filtros selecionados.</td></tr>';
      return;
    }

    corpo.innerHTML = lista.map(function (a) {
      var st = diaAttendance[a.matricula];
      var sn = diaSnacks[a.matricula];
      var chamada = st === 'P' ? '<span class="selo selo-verde">Presente</span>'
        : (st === 'F' ? '<span class="selo selo-vermelho">Falta</span>' : '<span class="selo selo-cinza">Sem registro</span>');
      var lanche = sn ? '<span class="selo selo-verde">Comeu</span>'
        : (st === 'F' ? '<span class="selo selo-vermelho">Bloqueado</span>' : '<span class="selo selo-cinza">Pendente</span>');
      
      var fotoHtml = a.foto ? '<div class="foto-tabela-wrap"><img src="' + a.foto + '" class="foto-tabela-img" alt="Foto"></div>'
        : '<div class="foto-tabela-wrap"><span class="foto-tabela-sem">👤</span></div>';

      return '<tr>' +
        '<td>' + fotoHtml + '</td>' +
        '<td class="t-nome">' + esc(a.nome) + '</td>' +
        '<td>' + esc(a.matricula) + '</td>' +
        '<td><span class="t-curso" style="display:inline; font-size:.85rem;">' + esc(a.curso) + '</span></td>' +
        '<td>' + esc(a.turno || 'N/I') + '</td>' +
        '<td>' + chamada + '</td>' +
        '<td>' + lanche + '</td>' +
        '<td>' + (sn ? esc(fmtHora(sn.hora)) : '-') + '</td>' +
        '<td>' + (sn ? (sn.via === 'manual' ? 'Manual' : 'QR Code') : '-') + '</td>' +
        '<td><button type="button" class="btn btn-del" data-del="' + esc(a.matricula) + '" title="Cancelar matrícula de quem desistiu">Cancelar Matrícula</button></td>' +
        '</tr>';
    }).join('');
  }

  function zerarSistema() {
    var ok = window.confirm(
      'Zerar o sistema para o dia seguinte?\\n\\n' +
      'O registo de hoje (chamadas, retiradas, infrações e cardápio) será arquivado no Histórico.\\n' +
      'As chamadas e lanches do dia a dia serão limpos.\\n' +
      'Os alunos cadastrados continuam salvos.'
    );
    if (!ok) return;

    sincronizarHojeNoHistorico();
    db.attendance = {};
    db.snacks = {};
    db.infractions = [];
    salvarDB();

    dataConsultaAdmin = getIsoHoje();
    toast('Dia arquivado com sucesso no histórico. Sistema preparado para o próximo dia.', 'ok');
    renderTudo();
  }

  // ---------- Renderização Geral ----------
  function renderTudo() {
    renderAluno();
    renderProfessor();
    renderCantina();
    renderAdmin();
  }

  // ---------- Eventos ----------
  function mudarDataConsulta(dataIso) {
    dataConsultaAdmin = dataIso;
    renderAdmin();
  }

  function dataRelativa(diasAtras) {
    var d = new Date();
    d.setDate(d.getDate() - diasAtras);
    return getIsoHoje(d);
  }

  function iniciar() {
    $$('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { irPara(b.getAttribute('data-view')); });
    });
    $$('.aba').forEach(function (b) {
      b.addEventListener('click', function () { trocarAba(b.getAttribute('data-aba')); });
    });
    $('#form-cadastro').addEventListener('submit', cadastrar);
    $('#form-login').addEventListener('submit', entrar);
    $('#btn-sair').addEventListener('click', sair);
    $('#btn-zerar').addEventListener('click', zerarSistema);
    $('#btn-camera').addEventListener('click', reiniciarCamera);
    $('#busca').addEventListener('input', renderBusca);
    $('#adm-filtro').addEventListener('change', renderAdmin);
    if ($('#adm-filtro-turno')) $('#adm-filtro-turno').addEventListener('change', renderAdmin);

    // Eventos da Câmera de Cadastro (Selfie)
    $('#btn-abrir-camera').addEventListener('click', abrirCameraSelfie);
    $('#btn-capturar-foto').addEventListener('click', capturarFotoSelfie);
    $('#btn-remover-foto').addEventListener('click', resetarFotoCadastro);
    $('#file-foto-aluno').addEventListener('change', carregarFotoArquivo);

    // Cantina: Salvar Cardápio e Estoque
    $('#btn-salvar-estoque').addEventListener('click', salvarCardapioEstoque);

    // Cantina: Modal de Conferência
    $('#btn-conf-aprovar').addEventListener('click', confirmarEntregaLancheModal);
    $('#btn-conf-fraude').addEventListener('click', reportarFraudeModal);
    $('#btn-conf-cancelar').addEventListener('click', fecharModalConferencia);

    // Professor: Seleção de Curso e Troca
    $('#prof-selecao-curso').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-curso]');
      if (btn) selecionarCursoProfessor(btn.getAttribute('data-curso'));
    });
    $('#btn-trocar-curso').addEventListener('click', trocarCursoProfessor);
    if ($('#prof-filtro-turno')) $('#prof-filtro-turno').addEventListener('change', renderProfessor);

    // Filtro de data do histórico
    var inputData = $('#adm-data-filtro');
    inputData.value = getIsoHoje();
    inputData.addEventListener('change', function () {
      if (inputData.value) mudarDataConsulta(inputData.value);
    });

    $('#btn-filtro-hoje').addEventListener('click', function () { mudarDataConsulta(getIsoHoje()); });
    $('#btn-filtro-ontem').addEventListener('click', function () { mudarDataConsulta(dataRelativa(1)); });
    $('#btn-filtro-7dias').addEventListener('click', function () { mudarDataConsulta(dataRelativa(7)); });
    $('#btn-voltar-hoje').addEventListener('click', function () { mudarDataConsulta(getIsoHoje()); });

    // Cliques na lista do professor
    $('#lista-professor').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-m]');
      if (b) marcarChamada(b.getAttribute('data-m'), b.getAttribute('data-s'));
    });

    // Conferência manual na cantina
    $('#resultados').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-conferir]');
      if (b) abrirModalConferencia(b.getAttribute('data-conferir'), 'manual');
    });

    // Cancelamento / Deletar matrícula na tabela da coordenação
    $('#adm-tabela').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-del]');
      if (b) deletarMatricula(b.getAttribute('data-del'));
    });

    // Arquivar infração
    $('#lista-infracoes').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-arquivar-infra]');
      if (b) arquivarInfracao(Number(b.getAttribute('data-arquivar-infra')));
    });

    // Sincronização entre abas
    window.addEventListener('storage', function (e) {
      if (e.key === null || e.key === KEY_DB || e.key === KEY_SESSAO) {
        db = carregarDB();
        sessao = carregarSessao();
        renderTudo();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        pararScanner();
        pararCameraSelfie();
      } else if (viewAtual === 'cantina') {
        iniciarScanner();
      }
    });
    window.addEventListener('pagehide', function () {
      pararScanner();
      pararCameraSelfie();
    });

    $('#pix').hidden = true;
    irPara('aluno');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();